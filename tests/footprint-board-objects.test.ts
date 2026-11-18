import assert from "node:assert/strict";
import { test } from "node:test";
import {
	drawShape,
	type EditorShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	createPad,
	onFootprintLayer,
} from "@ecad/drawing-core/footprint/shapes.ts";
import {
	type BufferAttribute,
	DoubleSide,
	DynamicDrawUsage,
	type Mesh,
	MeshBasicMaterial,
	type Object3D,
} from "three";
import { createTextShape } from "#/drawing/text.ts";
import { getPlanarGeometry } from "#/engine/planar-object.ts";
import { PlanarOutline } from "#/engine/planar-outline.ts";
import { createSceneDisplay } from "#/engine/scene.ts";
import { createBoardBuilder, DRILL_LAYER_ID } from "#/footprint/board.ts";
import {
	type BoardObject,
	createBoardObjects,
} from "#/footprint/board-objects.ts";
import { required } from "./helpers/required.ts";

const silkLine = (id: number, y: number) =>
	onFootprintLayer(drawShape(id, "line", { x: -1, y }, { x: 1, y }), "F.SilkS");

function twoPadsAHoleAndSilk(): EditorShape[] {
	return [
		createPad(1, { x: -0.9, y: 0 }, "smd", "", "F.Cu"),
		createPad(2, { x: 0.9, y: 0 }, "smd", "", "F.Cu"),
		createPad(3, { x: 0, y: 3 }, "through-hole", "", "F.Cu"),
		silkLine(4, 1),
	];
}

const part = (object: Object3D, name: string) =>
	required(
		object.children.find((child) => child.userData.planarPart === name),
	) as Mesh;
const positions = (object: Object3D, name = "fill") =>
	part(object, name).geometry.getAttribute("position") as BufferAttribute;
const layerOf = (board: readonly BoardObject[], id: string) =>
	required(board.find((layer) => layer.id === id));
const moved = (shapes: readonly EditorShape[], id: number, x: number) =>
	shapes.map((shape) => (shape.id === id ? { ...shape, x } : shape));

test("dragging a pad rewrites its copper in the layer the 3D view already shows", () => {
	const builder = createBoardBuilder(createBoardObjects());
	const shapes = twoPadsAHoleAndSilk();
	const first = builder.build(shapes);
	const copper = layerOf(first, "footprint:F.Cu");
	const shown = createSceneDisplay([copper]);
	const before = positions(copper.object).array.slice();
	const uploaded = positions(copper.object).version;
	let outlines = 0;
	copper.object.traverse((child) => {
		if (child instanceof PlanarOutline) outlines++;
	});
	assert.equal(outlines, 0);
	assert.equal(shown.planar, true);

	const dragged = moved(shapes, 2, 2.4);
	const second = builder.build(dragged);
	assert.equal(layerOf(second, "footprint:F.Cu"), copper);
	assert.equal(
		layerOf(second, "footprint:F.SilkS"),
		layerOf(first, "footprint:F.SilkS"),
	);
	const after = positions(copper.object);
	assert.notDeepEqual(after.array, before);
	assert.ok(after.version > uploaded);
	const [range] = after.updateRanges;
	assert.ok(range.count > 0 && range.count < after.array.length);
	assert.deepEqual(
		after.array.slice(0, range.start),
		before.slice(0, range.start),
	);
	const xs = [...after.array].filter((_, index) => index % 3 === 0);
	assert.ok(Math.abs(Math.max(...xs) - (2.4 + 0.5)) < 1e-6);
	assert.ok(
		required(part(copper.object, "fill").geometry.boundingBox).max.x >=
			2.4 + 0.5 - 1e-6,
	);
	assert.equal(
		positions(shown.object.children[0]).array,
		positions(copper.object).array,
	);
	assert.equal(copper.objects.length, 3);
	assert.equal(after.usage, DynamicDrawUsage);

	const box = () => required(part(copper.object, "fill").geometry.boundingBox);
	assert.ok(Math.abs(box().max.x - 2.9) < 1e-6);
	const third = builder.build(shapes);
	assert.equal(layerOf(third, "footprint:F.Cu"), copper);
	assert.ok(Math.abs(box().max.x - 1.4) < 1e-6);
	assert.ok(Math.abs(box().min.x + 1.4) < 1e-6);
	builder.build(moved(shapes, 3, 0.2));
	assert.ok(Math.abs(box().max.x - 1.4) < 1e-6);
	const sphere = required(part(copper.object, "fill").geometry.boundingSphere);
	for (const corner of [box().min, box().max])
		assert.ok(sphere.center.distanceTo(corner) <= sphere.radius + 1e-6);

	builder.release(third);
	shown.dispose();
	builder.dispose();
});

test("adding a pad builds a new copper layer, and the one it replaces is freed", () => {
	const builder = createBoardBuilder(createBoardObjects());
	const shapes = twoPadsAHoleAndSilk();
	const first = builder.build(shapes);
	const copper = layerOf(first, "footprint:F.Cu");
	let freed = 0;
	part(copper.object, "fill").geometry.addEventListener("dispose", () => {
		freed++;
	});
	const second = builder.build([
		...shapes,
		createPad(5, { x: 0, y: -2 }, "smd", "", "F.Cu"),
	]);
	assert.notEqual(layerOf(second, "footprint:F.Cu"), copper);
	assert.equal(freed, 0);
	builder.release(second);
	assert.equal(freed, 1);
	builder.dispose();
});

test("dragging a through-hole pad moves its hole and tells the hole mask to repaint", () => {
	const builder = createBoardBuilder(createBoardObjects());
	const shapes = twoPadsAHoleAndSilk();
	const drills = layerOf(builder.build(shapes), DRILL_LAYER_ID);
	const edges = required(getPlanarGeometry(drills.object)).edges;
	const before = edges.slice();
	const barrel = positions(drills.object, "walls").array.slice();
	const next = layerOf(builder.build(moved(shapes, 3, 1.5)), DRILL_LAYER_ID);
	assert.equal(next, drills);
	assert.equal(drills.revision, 1);
	assert.equal(required(getPlanarGeometry(drills.object)).edges, edges);
	edges.forEach((value, index) => {
		const shift = index % 3 === 0 ? 1.5 : 0;
		assert.ok(Math.abs(value - shift - before[index]) < 1e-6);
	});
	assert.notDeepEqual(positions(drills.object, "walls").array, barrel);
	assert.ok(part(drills.object, "walls").geometry.getAttribute("normal"));
	builder.dispose();
});

const measure = (text: string) => text.length * 57.6;

function boardWithText() {
	const drawn: string[] = [];
	const freed: string[] = [];
	const builder = createBoardBuilder(
		createBoardObjects({
			measure,
			textMaterial: (text) => {
				drawn.push(text);
				return {
					material: new MeshBasicMaterial(),
					dispose: () => freed.push(text),
				};
			},
		}),
	);
	const label = onFootprintLayer(
		createTextShape(7, { x: 0, y: 2 }, measure),
		"F.SilkS",
	);
	const shapes: EditorShape[] = [
		createPad(1, { x: -0.9, y: 0 }, "smd", "1", "F.Cu"),
		createPad(2, { x: 0.9, y: 0 }, "smd", "2", "F.Cu"),
		createPad(3, { x: 0, y: 3 }, "smd", "1", "F.Cu"),
		label,
	];
	return { builder, shapes, label, drawn, freed };
}

const textMesh = (layer: BoardObject) => layer.object.children[0] as Mesh;
const corners = (layer: BoardObject) =>
	textMesh(layer).geometry.getAttribute("position") as BufferAttribute;

test("back silkscreen text is drawn mirrored about its own axis and stays visible from both sides", () => {
	const { builder, shapes, label } = boardWithText();
	const rotation = Math.PI / 3;
	const turned = (layer: "F.SilkS" | "B.SilkS") =>
		shapes.map((shape) =>
			shape.id === 7 ? { ...label, rotation, layer } : shape,
		);
	const front = corners(
		layerOf(builder.build(turned("F.SilkS")), "footprint:F.SilkS:text"),
	).array.slice();
	const back = layerOf(
		builder.build(turned("B.SilkS")),
		"footprint:B.SilkS:text",
	);
	const along = { x: Math.cos(rotation), y: Math.sin(rotation) };
	const center = { x: label.x, y: label.y };
	const backCorners = corners(back).array;
	for (let at = 0; at < front.length; at += 3) {
		const offset =
			(front[at] - center.x) * along.x + (front[at + 1] - center.y) * along.y;
		assert.ok(
			Math.abs(backCorners[at] - (front[at] - 2 * offset * along.x)) < 1e-6,
		);
		assert.ok(
			Math.abs(backCorners[at + 1] - (front[at + 1] - 2 * offset * along.y)) <
				1e-6,
		);
	}
	const materials = textMesh(back).material as MeshBasicMaterial[];
	assert.ok(materials.every((material) => material.side === DoubleSide));
	builder.dispose();
});
