import { GeometryCompiler } from "./geometry";
import { compileMesh } from "./mesh";
import type { MeshObject, MeshRequest, MeshResult } from "./mesh";

const layers = new Map<
	string,
	{ revision: number; objects: MeshObject[]; compiler: GeometryCompiler }
>();
self.onmessage = (event: MessageEvent<MeshRequest>) => {
	const request = event.data;
	if (request.type === "release") {
		if (layers.get(request.layerId)?.revision === request.revision)
			layers.delete(request.layerId);
		return;
	}
	const { layerId, revision, tolerance } = request;
	try {
		if (request.objects)
			layers.set(layerId, {
				revision,
				objects: request.objects,
				compiler: new GeometryCompiler(),
			});
		const layer = layers.get(layerId);
		if (!layer || layer.revision !== revision) return;
		const vertices = compileMesh(layer.objects, layer.compiler, tolerance);
		const response: MeshResult = { layerId, revision, tolerance, vertices };
		self.postMessage(response, { transfer: [vertices.buffer] });
	} catch (error) {
		const response: MeshResult = {
			layerId,
			revision,
			tolerance,
			error: error instanceof Error ? error.message : String(error),
		};
		self.postMessage(response);
	}
};
