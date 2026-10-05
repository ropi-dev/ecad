import { Effect } from "effect";
import type { ViewerScene } from "#/engine/scene.ts";
import { runEffect } from "#/lib/effect.ts";
import {
	acquireImported,
	InvalidFile,
	readFile,
	requestWorker,
} from "./import-effects";
import { createStepGroup, disposeStepGroup } from "./step/scene";
import type { StepModel } from "./step/types/StepModel";

export interface ParsedStepFile {
	name: string;
	parts: { id: string; name: string; triangles: number }[];
	scene: ViewerScene;
	dispose: () => void;
}

export function parseStepFileEffect(file: File) {
	return Effect.gen(function* () {
		if (!/\.(step|stp)$/i.test(file.name))
			return yield* new InvalidFile({
				message: "Choose a .step or .stp file.",
			});
		if (!file.size)
			return yield* new InvalidFile({ message: "This STEP file is empty." });
		const buffer = yield* readFile(() => file.arrayBuffer());
		const model = yield* requestWorker<StepModel>({
			create: () =>
				new Worker(new URL("./step/parse.worker.ts", import.meta.url), {
					type: "module",
				}),
			message: { buffer, name: file.name },
			transfer: [buffer],
			timeout: 120_000,
			timeoutMessage: "STEP import timed out. Try a smaller file.",
			parseMessage: "Unable to read this STEP file.",
			startMessage: "Unable to start the STEP importer.",
			receiveMessage: "Unable to receive the STEP model.",
		});
		return yield* acquireImported(
			Effect.try({
				try: (): ParsedStepFile => {
					const object = createStepGroup(model);
					let disposed = false;
					return {
						name: model.name,
						parts: model.meshes.map((mesh) => ({
							id: mesh.id,
							name: mesh.name,
							triangles: mesh.index.array.length / 3,
						})),
						scene: object.children.map((part) => ({
							type: "spatial",
							object: part,
						})),
						dispose: () => {
							if (!disposed) {
								disposed = true;
								disposeStepGroup(object);
							}
						},
					};
				},
				catch: (cause) =>
					new InvalidFile({
						message:
							cause instanceof Error
								? cause.message
								: "Unable to create the STEP geometry.",
					}),
			}),
			(parsed) => parsed.dispose(),
		);
	});
}

export function parseStepFile(
	file: File,
	signal?: AbortSignal,
): Promise<ParsedStepFile> {
	return runEffect(Effect.scoped(parseStepFileEffect(file)), signal);
}
