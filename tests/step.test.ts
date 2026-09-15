import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import createImporter from "occt-import-js";
import { Box3, Color, Mesh, SRGBColorSpace, Vector3 } from "three";
import { createStepGroup, disposeStepGroup } from "#/formats/step/scene.ts";
import { parseStepFile } from "#/formats/parseStepFile.ts";
import type { StepModel } from "#/formats/step/types/StepModel.ts";

test("STEP geometry retains millimetre dimensions for different source units and centers the model", async () => {
	const importer = await createImporter();
	for (const unit of ["mm", "m", "in"]) {
		const buffer = await readFile(`node_modules/occt-import-js/test/testfiles/cube-units/cube-${unit}.step`);
		const result = importer.ReadStepFile(buffer, { linearUnit: "millimeter" });
		assert.ok(result.success);
		const group = createStepGroup({ name: unit, meshes: result.meshes.map((mesh, index) => ({ ...mesh, id: String(index) })) });
		const bounds = new Box3().setFromObject(group);
		assert.ok(bounds.getCenter(new Vector3()).length() < 1e-5);
		const size = bounds.getSize(new Vector3());
		for (const value of size.toArray()) assert.ok(Math.abs(value - 1000) < 1e-4, `${unit}: ${size.toArray()}`);
		disposeStepGroup(group);
	}
});

test("STEP face colors preserve uncolored triangles and dispose geometry and materials", () => {
	const model: StepModel = { name: "colored", meshes: [{
		id: "part", name: "part", color: [0, 1, 0],
		attributes: { position: { array: [10, 10, 0, 20, 10, 0, 10, 20, 0, 20, 20, 0] } },
		index: { array: [0, 1, 2, 1, 3, 2] },
		brep_faces: [{ first: 1, last: 1, color: [1, 0, 0] }],
	}] };
	const group = createStepGroup(model);
	const mesh = group.children[0];
	assert.ok(mesh instanceof Mesh);
	assert.equal(mesh.geometry.getAttribute("normal").count, 4);
	assert.deepEqual(mesh.geometry.groups, [{ start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 }]);
	assert.ok(mesh.material[1].color.equals(new Color().setRGB(1, 0, 0, SRGBColorSpace)));
	let disposed = 0;
	mesh.geometry.addEventListener("dispose", () => disposed++);
	for (const material of mesh.material) material.addEventListener("dispose", () => disposed++);
	disposeStepGroup(group);
	assert.equal(disposed, 3);
});

test("STEP file validation rejects empty, wrong-extension and aborted inputs", async () => {
	await assert.rejects(parseStepFile(new File([], "empty.step")), /empty/);
	await assert.rejects(parseStepFile(new File(["invalid"], "board.gbr")), /\.step or \.stp/);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(parseStepFile(new File(["STEP"], "model.STEP"), controller.signal), { name: "AbortError" });
});
