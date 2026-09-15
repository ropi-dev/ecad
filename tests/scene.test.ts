import assert from "node:assert/strict";
import test from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { createSceneDisplay, type ViewerScene } from "#/engine/scene";

test("scene arrays display multiple objects in order without taking ownership", () => {
	const geometry = new BoxGeometry(2, 2, 2);
	const material = new MeshBasicMaterial();
	const owner = new Group();
	const first = new Mesh(geometry, material);
	const second = new Mesh(geometry, material);
	first.name = "first";
	second.name = "second";
	first.position.x = -10;
	second.position.x = 10;
	second.visible = false;
	owner.add(first, second);
	const scene: ViewerScene = [first, second].map((object) => ({
		type: "spatial",
		object,
	}));
	let disposed = 0;
	geometry.addEventListener("dispose", () => disposed++);
	material.addEventListener("dispose", () => disposed++);
	const displays = [createSceneDisplay(scene), createSceneDisplay(scene)];
	for (const display of displays) {
		assert.deepEqual(
			display.object.children.map((object) => object.name),
			["first", "second"],
		);
		assert.notEqual(display.object.children[0], first);
		assert.equal(display.object.children[1].visible, false);
		const bounds = new Box3().setFromObject(display.object);
		assert.equal(bounds.min.x, -11);
		assert.equal(bounds.max.x, 11);
		display.object.children[0].visible = false;
		display.dispose();
		display.dispose();
	}
	assert.equal(first.parent, owner);
	assert.equal(second.parent, owner);
	assert.equal(first.visible, true);
	assert.equal(disposed, 0);
	geometry.dispose();
	material.dispose();
	assert.equal(disposed, 2);
});
