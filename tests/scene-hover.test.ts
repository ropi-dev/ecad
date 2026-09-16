import assert from "node:assert/strict";
import test from "node:test";
import {
	BoxGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	Ray,
	Vector3,
} from "three";
import { createSceneDisplay } from "#/engine/scene";
import { createSceneHover } from "#/engine/scene-hover";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
} from "#/engine/planar-object";
import type { PlanarObject, SceneObject } from "#/engine/types";

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

test("model hover picks one part without recoloring shared materials or owning geometry", () => {
	const geometry = new BoxGeometry(2, 2, 2);
	const material = new MeshBasicMaterial({ color: "#808080" });
	const group = new Group();
	const left = new Mesh(geometry, material);
	const right = new Mesh(geometry, material);
	left.position.x = -3;
	right.position.x = 3;
	group.add(left, right);
	const display = createSceneDisplay([{ type: "spatial", object: group }]);
	const hover = createSceneHover(display.entries);
	let disposed = 0;
	geometry.addEventListener("dispose", () => disposed++);
	assert.equal(hover.update(ray(-3), 0), 1);
	const overlay = hover.object.children[0] as Mesh;
	assert.equal(overlay.geometry, geometry);
	assert.notEqual(overlay.material, material);
	assert.equal(overlay.matrix.elements[12], -3);
	assert.equal(material.color.getHexString(), "808080");
	const displayed = display.object.children[0].children[0] as Mesh<
		BoxGeometry,
		MeshBasicMaterial
	>;
	displayed.material.color.set("white");
	assert.equal(hover.update(ray(-3), 0), 1);
	assert.notEqual(
		(overlay.material as MeshBasicMaterial).color.getHexString(),
		"ffffff",
	);
	assert.equal(hover.update(ray(3), 0), 1);
	assert.equal((hover.object.children[0] as Mesh).matrix.elements[12], 3);
	display.object.visible = false;
	assert.equal(hover.update(ray(3), 0), 0);
	hover.dispose();
	display.dispose();
	assert.equal(disposed, 0);
	geometry.dispose();
	material.dispose();
});

test("hover restrictions skip foreground layers and clear stale highlights when focus changes", () => {
	const display = createSceneDisplay([
		drawing([rect(0, 4)]),
		{ ...drawing([rect(0, 2), rect(5, 2)]), id: "upper" },
	]);
	const [lower, upper] = display.object.children;
	upper.position.z = 1;
	const hover = createSceneHover(display.entries);
	assert.equal(hover.update(ray(0), 0), 1);
	assert.equal(hover.object.children[0].matrix.elements[14], 1);
	upper.userData.hoverEnabled = false;
	assert.equal(hover.update(ray(0), 0), 1);
	assert.equal(hover.object.children[0].matrix.elements[14], 0);
	assert.equal(
		hover.update(ray(5), 0),
		0,
		"unfocused shapes cannot be highlighted",
	);
	upper.userData.hoverEnabled = true;
	lower.userData.hoverEnabled = false;
	assert.equal(hover.update(ray(5), 0), 1);
	upper.userData.hoverEnabled = false;
	assert.equal(
		hover.update(ray(5), 0),
		0,
		"existing highlight clears without pointer movement",
	);
	assert.equal(hover.object.children.length, 0);
	lower.userData.hoverEnabled = true;
	upper.userData.hoverEnabled = true;
	assert.equal(hover.update(ray(5), 0), 1);
	display.object.userData.hoverEnabled = false;
	assert.equal(
		hover.update(ray(5), 0),
		0,
		"ancestor restrictions apply to the whole subtree",
	);
	hover.dispose();
	display.dispose();
});

test("moving between connected shapes reuses a highlight spanning the full connection", () => {
	const display = createSceneDisplay([
		drawing([rect(-2), rect(0), rect(2), rect(6)]),
	]);
	const hover = createSceneHover(display.entries);
	assert.equal(hover.update(ray(-2), 0), 1);
	const overlay = hover.object.children[0] as Mesh;
	overlay.geometry.computeBoundingBox();
	assert.equal(overlay.geometry.boundingBox?.min.x, -3);
	assert.equal(overlay.geometry.boundingBox?.max.x, 3);
	assert.equal(hover.update(ray(2), 0), 1);
	assert.equal(hover.object.children[0], overlay);
	assert.equal(hover.update(ray(6), 0), 1);
	assert.notEqual(hover.object.children[0], overlay);
	hover.dispose();
	display.dispose();
});
