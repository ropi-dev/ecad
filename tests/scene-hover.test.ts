import assert from "node:assert/strict";
import test from "node:test";
import {
	type BoxGeometry,
	type Mesh,
	type MeshBasicMaterial,
	Ray,
	Vector3,
} from "three";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
} from "#/engine/planar-object.ts";
import { createSceneDisplay } from "#/engine/scene.ts";
import { createSceneHover } from "#/engine/scene-hover.ts";
import type { PlanarObject, SceneObject } from "#/engine/types.ts";

const rect = (
	x: number,
	size = 2,
	polarity: "dark" | "clear" = "dark",
): SceneObject => ({
	id: `${x}:${size}:${polarity}`,
	geometry: { type: "rect", x, y: 0, width: size, height: size },
	bounds: {
		minX: x - size / 2,
		minY: -size / 2,
		maxX: x + size / 2,
		maxY: size / 2,
	},
	polarity,
	attributes: {},
});
const drawing = (objects: SceneObject[]): PlanarObject => ({
	type: "planar",
	id: "drawing",
	name: "Drawing",
	objects,
	bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
	color: "#e8b77e",
	visible: true,
	opacity: 1,
	metadata: {},
});
const ray = (x: number, y = 0) =>
	new Ray(new Vector3(x, y, 10), new Vector3(0, 0, -1));

for (const parsed of [false, true]) {
	test(`hover isolates an untagged planar shape in a ${parsed ? "precompiled" : "vector"} scene`, () => {
		const source = drawing([rect(-3), rect(3)]);
		const compiled = parsed ? createPlanarObject3D(source) : undefined;
		const display = createSceneDisplay(
			compiled ? [{ type: "spatial", object: compiled }] : [source],
		);
		const hover = createSceneHover(display.entries);
		assert.equal(hover.update(ray(-3), 0), 1);
		const overlay = hover.object.children[0] as Mesh;
		overlay.geometry.computeBoundingBox();
		assert.equal(overlay.geometry.boundingBox?.min.x, -4);
		assert.equal(overlay.geometry.boundingBox?.max.x, -2);
		assert.equal(hover.update(ray(-3), 0), 1);
		assert.equal(
			hover.object.children[0],
			overlay,
			"pointer motion inside the same shape reuses its mesh",
		);
		let disposed = 0;
		overlay.geometry.addEventListener("dispose", () => disposed++);
		assert.equal(hover.update(ray(3), 0), 1);
		assert.equal(disposed, 1);
		assert.equal(hover.update(ray(0), 0), 0);
		assert.equal(hover.object.children.length, 0);
		hover.dispose();
		display.dispose();
		if (compiled) disposePlanarObject3D(compiled);
	});
}

test("planar hover respects clear holes, transforms, hidden layers and live styles", () => {
	const display = createSceneDisplay([
		drawing([rect(0, 4), rect(0, 2, "clear")]),
	]);
	const layer = display.object.children[0];
	layer.position.x = 10;
	const hover = createSceneHover(display.entries);
	assert.equal(hover.update(ray(10), 0), 0);
	assert.equal(hover.update(ray(11.5), 0), 1);
	const overlay = hover.object.children[0] as Mesh;
	assert.equal(overlay.matrix.elements[12], 10);
	const position = overlay.geometry.getAttribute("position");
	let area = 0;
	for (let i = 0; i < position.count; i += 3)
		area +=
			Math.abs(
				(position.getX(i + 1) - position.getX(i)) *
					(position.getY(i + 2) - position.getY(i)) -
					(position.getX(i + 2) - position.getX(i)) *
						(position.getY(i + 1) - position.getY(i)),
			) / 2;
	assert.equal(area, 12);
	const fill = layer.children[0] as Mesh<BoxGeometry, MeshBasicMaterial>;
	const original = fill.material.color.getHex();
	assert.notEqual(
		(overlay.material as MeshBasicMaterial).color.getHex(),
		original,
	);
	fill.material.opacity = 0;
	assert.equal(hover.update(ray(11.5), 0), 0);
	fill.material.opacity = 1;
	layer.visible = false;
	assert.equal(hover.update(ray(11.5), 0), 0);
	layer.visible = true;
	assert.equal(hover.update(ray(11.5), 0), 1);
	assert.equal(hover.update(null, 0), 0);
	assert.equal(fill.material.color.getHex(), original);
	hover.dispose();
	display.dispose();
});
