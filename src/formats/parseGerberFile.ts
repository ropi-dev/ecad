import type { ParseResult } from "#/engine";
import type { PlanarGeometry } from "#/engine/planar-geometry";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
} from "#/engine/planar-object";
import type { PlanarObject, SpatialObject } from "#/engine/scene";

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

export async function parseGerberFile(
	file: File,
	signal?: AbortSignal,
): Promise<ParsedGerberFile> {
	signal?.throwIfAborted();
	const source = await file.text();
	signal?.throwIfAborted();
	const parsed = await new Promise<WorkerResult>((resolve, reject) => {
		const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), {
			type: "module",
		});
		let settled = false;
		const finish = (error: unknown, result?: WorkerResult) => {
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
			() => finish(new Error("Parsing timed out. Try a smaller file.")),
			20000,
		);
		signal?.addEventListener("abort", abort, { once: true });
		worker.onmessage = (
			event: MessageEvent<{ result?: WorkerResult; error?: string }>,
		) => {
			if (event.data.error || !event.data.result)
				finish(new Error(event.data.error || "Unable to parse this file."));
			else finish(null, event.data.result);
		};
		worker.onerror = (event) =>
			finish(new Error(event.message || "Unable to parse this file."));
		try {
			if (signal?.aborted) abort();
			else worker.postMessage({ id: 0, source, filename: file.name });
		} catch (error) {
			finish(error);
		}
	});
	signal?.throwIfAborted();
	const errors = parsed.diagnostics.filter(
		(entry) => entry.severity === "error",
	);
	if (errors.length)
		throw new Error(errors.map((entry) => entry.message).join("; "));
	if (!parsed.mesh?.positions.length)
		throw new Error("This file contains no drawable geometry.");
	const id = crypto.randomUUID();
	const drawing: PlanarObject = {
		...parsed.object,
		id,
		objects: parsed.object.objects.map((object) => ({
			...object,
			id: `${id}:${object.id}`,
		})),
	};
	const mesh = createPlanarObject3D(drawing, parsed.mesh);
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
}
