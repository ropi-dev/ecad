import { Effect } from "effect";
import type { ParseResult } from "#/engine/types.ts";
import type { PlanarGeometry } from "#/engine/planar-geometry.ts";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
} from "#/engine/planar-object.ts";
import type { PlanarObject, SpatialObject } from "#/engine/scene.ts";
import { runEffect } from "#/lib/effect.ts";
import { errorMessage } from "#/lib/error-message.ts";
import {
	acquireImported,
	InvalidFile,
	readFile,
	requestWorker,
} from "./import-effects";

interface WorkerResult extends ParseResult {
	mesh?: PlanarGeometry;
}
export interface ParsedGerberObject
	extends Omit<PlanarObject, "type">,
		SpatialObject {
	dispose: () => void;
}
export interface ParsedGerberFile extends Omit<ParseResult, "object"> {
	object: ParsedGerberObject;
	scene: readonly ParsedGerberObject[];
	dispose: () => void;
}

export function parseGerberFileEffect(file: File) {
	return Effect.gen(function* () {
		const source = yield* readFile(() => file.text());
		const parsed = yield* requestWorker<WorkerResult>({
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
		const errors = parsed.diagnostics.filter(
			(entry) => entry.severity === "error",
		);
		if (errors.length)
			return yield* new InvalidFile({
				message: errors.map((entry) => entry.message).join("; "),
			});
		if (!parsed.mesh?.positions.length)
			return yield* new InvalidFile({
				message: "This file contains no drawable geometry.",
			});
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
