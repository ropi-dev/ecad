import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Box3, type Mesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { sourceModels } from "../scripts/sources.ts";
import { defaultModels } from "../src/index.ts";

const read = (url: string) => {
	const data = readFileSync(fileURLToPath(url));
	return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};

test("the catalog lists every source model once, with a portable ID", () => {
	const models = defaultModels();
	assert.deepEqual(
		models.map(({ id, name, category }) => ({ id, name, category })),
		sourceModels.map(({ id, name, category }) => ({ id, name, category })),
	);
	assert.equal(new Set(models.map(({ id }) => id)).size, models.length);
	for (const model of models) {
		assert.match(model.id, /^[a-z0-9][a-z0-9._-]{0,63}$/);
		assert.equal(model.id, model.name.toLowerCase());
		assert.ok(model.url.endsWith(`/models/${model.id}.glb`), model.url);
	}
});

test("every model is a binary glTF that three.js loads into coloured meshes on the board surface", async () => {
	const loader = new GLTFLoader();
	for (const model of defaultModels()) {
		const buffer = read(model.url);
		const header = new DataView(buffer);
		assert.equal(header.getUint32(0, true), 0x46546c67, model.id);
		assert.equal(header.getUint32(8, true), buffer.byteLength, model.id);
		const { scene } = await loader.parseAsync(buffer, "");
		const meshes: Mesh[] = [];
		scene.traverse((object) => {
			if ((object as Mesh).isMesh) meshes.push(object as Mesh);
		});
		assert.ok(meshes.length > 0, model.id);
		for (const mesh of meshes) {
			assert.ok(mesh.geometry.getAttribute("normal"), model.id);
			assert.ok(mesh.geometry.index, model.id);
		}
		const bounds = new Box3().setFromObject(scene);
		assert.ok(bounds.max.z > 0.2, `${model.id} rises above the board`);
		assert.ok(bounds.max.z < 20, `${model.id} is in millimetres`);
	}
});

test("models are copies and the source table stays unchanged", () => {
	const first = defaultModels();
	first[0].name = "changed";
	assert.notEqual(defaultModels()[0].name, "changed");
});
