import { compilePlanarGeometry } from "#/engine/planar-geometry";
import { parsers } from "./registry";

self.onmessage = (
	event: MessageEvent<{ id: number; source: string; filename: string }>,
) => {
	const { id, source, filename } = event.data;
	try {
		const result = parsers.parse(source, filename);
		const mesh = result.diagnostics.some((entry) => entry.severity === "error")
			? undefined
			: compilePlanarGeometry(result.object.objects);
		self.postMessage(
			{ id, result: { ...result, mesh } },
			{ transfer: mesh ? [mesh.positions.buffer, mesh.edges.buffer] : [] },
		);
	} catch (error) {
		self.postMessage({
			id,
			error:
				error instanceof Error ? error.message : "Unable to parse this file.",
		});
	}
};
