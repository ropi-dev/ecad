import createImporter from "occt-import-js";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

self.onmessage = async (
	event: MessageEvent<{ buffer: ArrayBuffer; name: string }>,
) => {
	try {
		const importer = await createImporter({ locateFile: () => wasmUrl });
		const result = importer.ReadStepFile(new Uint8Array(event.data.buffer), {
			linearUnit: "millimeter",
		});
		if (!result.success)
			throw new Error(
				"Unable to read this STEP file. It may be invalid or unsupported.",
			);
		const meshes = result.meshes
			.filter((mesh) => mesh.index.array.length > 0)
			.map((mesh) => ({ ...mesh, id: crypto.randomUUID() }));
		if (!meshes.length)
			throw new Error("This STEP file contains no drawable surfaces.");
		self.postMessage({ result: { name: event.data.name, meshes } });
	} catch (error) {
		self.postMessage({
			error:
				error instanceof Error
					? error.message
					: "Unable to read this STEP file.",
		});
	}
};
