import type { ViewerScene } from "#/engine/scene";
import { createStepGroup, disposeStepGroup } from "./step/scene";
import type { StepModel } from "./step/types/StepModel";

export interface ParsedStepFile {
	name: string;
	parts: { id: string; name: string; triangles: number }[];
	scene: ViewerScene;
	dispose: () => void;
}

export async function parseStepFile(
	file: File,
	signal?: AbortSignal,
): Promise<ParsedStepFile> {
	signal?.throwIfAborted();
	if (!/\.(step|stp)$/i.test(file.name))
		throw new Error("Choose a .step or .stp file.");
	if (!file.size) throw new Error("This STEP file is empty.");
	const buffer = await file.arrayBuffer();
	signal?.throwIfAborted();
	const model = await new Promise<StepModel>((resolve, reject) => {
		const worker = new Worker(
			new URL("./step/parse.worker.ts", import.meta.url),
			{ type: "module" },
		);
		let settled = false;
		const finish = (error: unknown, result?: StepModel) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			worker.terminate();
			if (result) resolve(result);
			else reject(error);
		};
		const abort = () =>
			finish(
				signal?.reason ??
					new DOMException("File loading cancelled.", "AbortError"),
			);
		const timeout = setTimeout(
			() => finish(new Error("STEP import timed out. Try a smaller file.")),
			120_000,
		);
		signal?.addEventListener("abort", abort, { once: true });
		worker.onmessage = (
			event: MessageEvent<{ result?: StepModel; error?: string }>,
		) => {
			if (event.data.result) finish(null, event.data.result);
			else
				finish(new Error(event.data.error || "Unable to read this STEP file."));
		};
		worker.onerror = (event) =>
			finish(new Error(event.message || "Unable to start the STEP importer."));
		worker.onmessageerror = () =>
			finish(new Error("Unable to receive the STEP model."));
		try {
			if (signal?.aborted) abort();
			else worker.postMessage({ buffer, name: file.name }, [buffer]);
		} catch (error) {
			finish(error);
		}
	});
	signal?.throwIfAborted();
	const object = createStepGroup(model);
	let disposed = false;
	return {
		name: model.name,
		parts: model.meshes.map((mesh) => ({
			id: mesh.id,
			name: mesh.name,
			triangles: mesh.index.array.length / 3,
		})),
		scene: object.children.map((part) => ({ type: "spatial", object: part })),
		dispose: () => {
			if (!disposed) {
				disposed = true;
				disposeStepGroup(object);
			}
		},
	};
}
