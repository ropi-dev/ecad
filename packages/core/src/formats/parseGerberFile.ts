import { Effect } from "effect";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
} from "#/engine/planar-object.ts";
import type { PlanarObject, SpatialObject } from "#/engine/scene.ts";
import type { Diagnostic, ParseResult } from "#/engine/types.ts";
import { runEffect } from "#/lib/effect.ts";
import { errorMessage } from "#/lib/error-message.ts";
import {
	asSentence,
	formatDiagnostic,
	summarizeDiagnostics,
} from "./diagnostics";
import {
	acquireImported,
	checkFileSize,
	InvalidFile,
	readFile,
	requestWorker,
} from "./import-effects";
import type { ParseWorkerResult } from "./parse-reply";

export interface ParsedGerberObject
	extends Omit<PlanarObject, "type">,
		SpatialObject {
	/** Recoverable problems; the layer renders everything else. */
	diagnostics: readonly Diagnostic[];
	dispose: () => void;
}
export interface ParsedGerberFile extends Omit<ParseResult, "object"> {
	object: ParsedGerberObject;
	scene: readonly ParsedGerberObject[];
	dispose: () => void;
}

export function parseGerberFileEffect(file: File) {
	return Effect.gen(function* () {
		const tooLarge = checkFileSize(file, "gerber");
		if (tooLarge) return yield* tooLarge;
		const source = yield* readFile(() => file.text());
		const parsed = yield* requestWorker<ParseWorkerResult>({
			create: () =>
				new Worker(new URL("./parse.worker.ts", import.meta.url), {
					type: "module",
				}),
			message: { id: 0, source, filename: file.name },
			timeout: 20_000,
			timeoutMessage: "Parsing timed out. Try a smaller file.",
			parseMessage: "Unable to parse this file.",
			startMessage: "Unable to parse this file.",
			receiveMessage: "Unable to receive the parsed file.",
		});
		const fatal = parsed.diagnostics.filter(
			(entry) => entry.severity === "fatal",
		);
		if (fatal.length)
			return yield* new InvalidFile({
				message: fatal
					.map((entry) => asSentence(formatDiagnostic(entry)))
					.join(" "),
			});
		if (!parsed.mesh?.positions.length) {
			// Explain an empty result with the commands that were skipped.
			const errors = parsed.diagnostics.filter(
				(entry) => entry.severity === "error",
			);
			return yield* new InvalidFile({
				message: errors.length
					? `This file contains no drawable geometry (${summarizeDiagnostics(errors)}).`
					: "This file contains no drawable geometry.",
			});
		}
		const geometry = parsed.mesh;
		return yield* acquireImported(
			Effect.try({
				try: (): ParsedGerberFile => {
					const id = crypto.randomUUID();
					const drawing: PlanarObject = {
						...parsed.object,
						id,
						objects: parsed.object.objects.map((object) => ({
							...object,
							id: `${id}:${object.id}`,
						})),
					};
					const mesh = createPlanarObject3D(drawing, geometry);
					let disposed = false;
					const dispose = () => {
						if (disposed) return;
						disposed = true;
						disposePlanarObject3D(mesh);
					};
					const object: ParsedGerberObject = {
						...drawing,
						type: "spatial",
						object: mesh,
						diagnostics: parsed.diagnostics,
						dispose,
					};
					return {
						diagnostics: parsed.diagnostics,
						format: parsed.format,
						units: parsed.units,
						object,
						scene: [object],
						dispose,
					};
				},
				catch: (cause) =>
					new InvalidFile({
						message: errorMessage(
							cause,
							"Unable to create the Gerber geometry.",
						),
					}),
			}),
			(parsed) => parsed.dispose(),
		);
	});
}

export function parseGerberFile(
	file: File,
	signal?: AbortSignal,
): Promise<ParsedGerberFile> {
	return runEffect(Effect.scoped(parseGerberFileEffect(file)), signal);
}
