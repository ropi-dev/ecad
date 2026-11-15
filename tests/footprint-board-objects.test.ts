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
	DynamicDrawUsage,
	type Mesh,
	MeshBasicMaterial,
	type Object3D,
} from "three";
import { createTextShape } from "#/drawing/text.ts";
import { getPlanarGeometry } from "#/engine/planar-object.ts";
import { PlanarOutline } from "#/engine/planar-outline.ts";
import { createSceneDisplay } from "#/engine/scene.ts";
import {
	type BoardLayerPlan,
	type BoardRegion,
	createBoardBuilder,
	DRILL_LAYER_ID,
} from "#/footprint/board.ts";
import {
	type BoardObject,
	createBoardObjects,
} from "#/footprint/board-objects.ts";
import { required } from "./helpers/required.ts";

const courtyard = (id: number, width = 4): EditorShape => ({
	id,
	kind: "rectangle",
	layer: "F.CrtYd",
	x: 0,
	y: 0,
	width,
	height: 2,
	rotation: 0,
	lineWidth: 0.15,
});
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

test("resizing a courtyard rebuilds its layer, because the outline no longer fits the buffers it had", () => {
	const builder = createBoardBuilder(createBoardObjects());
	const shapes = [...twoPadsAHoleAndSilk(), courtyard(9)];
	const drawn = layerOf(builder.build(shapes), "footprint:F.CrtYd");
	assert.equal(drawn.objects.length, 1);
	const turned = shapes.map((shape) =>
		shape.id === 9 ? { ...shape, rotation: Math.PI / 2, y: 1 } : shape,
	);
	assert.equal(layerOf(builder.build(turned), "footprint:F.CrtYd"), drawn);
	const filled = shapes.map((shape) =>
		shape.id === 9 ? { ...courtyard(9), filled: true } : shape,
	);
	const rebuilt = layerOf(builder.build(filled), "footprint:F.CrtYd");
	assert.notEqual(rebuilt, drawn);
	assert.ok(positions(rebuilt.object).count > positions(drawn.object).count);
	builder.dispose();
});

test("a board builder hands a changed layer its previous build and keeps the one it gets back", () => {
	const disposed: string[] = [];
	const seen: (string | undefined)[] = [];
	let reuse = true;
	const builder = createBoardBuilder(
		(plan: BoardLayerPlan, previous?: { name: string; dispose(): void }) => {
			if (plan.id !== "footprint:F.SilkS")
				return { name: plan.id, dispose() {} };
			seen.push(previous?.name);
			if (previous && reuse) return previous;
			const name = `silk#${seen.length}`;
			return { name, dispose: () => disposed.push(name) };
		},
	);
	const shapes = twoPadsAHoleAndSilk();
	const silk = (board: readonly { name: string }[]) =>
		required(board.find((layer) => layer.name.startsWith("silk")));
	const first = silk(builder.build(shapes));
	assert.equal(silk(builder.build(shapes)), first);
	assert.deepEqual(seen, [undefined]);
	const dragged = moved(shapes, 4, 0.5);
	const second = builder.build(dragged);
	assert.equal(silk(second), first);
	assert.deepEqual(seen, [undefined, "silk#1"]);
	builder.release(second);
	assert.deepEqual(disposed, []);
	assert.equal(silk(builder.build(dragged)), first);
	assert.equal(seen.length, 2);
	reuse = false;
	const third = builder.build(moved(shapes, 4, 1));
	assert.notEqual(silk(third), first);
	assert.deepEqual(disposed, []);
	builder.release(third);
	assert.deepEqual(disposed, ["silk#1"]);
	builder.dispose();
	assert.deepEqual(disposed, ["silk#1", "silk#3"]);
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

test("dragging a pad moves its number in place, and pads with the same number share one drawn glyph", () => {
	const { builder, shapes, drawn } = boardWithText();
	const first = builder.build(shapes);
	const numbers = layerOf(first, "footprint:F.Cu:pad-numbers");
	assert.deepEqual(drawn.filter((text) => text !== "Text").sort(), ["1", "2"]);
	const mesh = textMesh(numbers);
	assert.equal((mesh.material as MeshBasicMaterial[]).length, 2);
	assert.deepEqual(
		mesh.geometry.groups.map((group) => group.materialIndex),
		[0, 1, 0],
	);
	const before = corners(numbers).array.slice();
	const uploaded = corners(numbers).version;
	const second = builder.build(moved(shapes, 2, 2.4));
	assert.equal(layerOf(second, "footprint:F.Cu:pad-numbers"), numbers);
	assert.equal(
		layerOf(second, "footprint:F.SilkS:text"),
		layerOf(first, "footprint:F.SilkS:text"),
	);
	const after = corners(numbers).array;
	assert.ok(corners(numbers).version > uploaded);
	assert.deepEqual(after.slice(0, 12), before.slice(0, 12));
	assert.deepEqual(after.slice(24), before.slice(24));
	for (let corner = 12; corner < 24; corner += 3) {
		assert.ok(Math.abs(after[corner] - before[corner] - 1.5) < 1e-6);
		assert.equal(after[corner + 1], before[corner + 1]);
	}
	assert.equal(drawn.filter((text) => text === "2").length, 1);
	const far = builder.build(moved(shapes, 2, 40));
	assert.equal(layerOf(far, "footprint:F.Cu:pad-numbers"), numbers);
	const sphere = required(textMesh(numbers).geometry.boundingSphere);
	assert.ok(sphere.center.x + sphere.radius >= 40);
	assert.ok(required(textMesh(numbers).geometry.boundingBox).max.x >= 40);
	builder.dispose();
});

test("moving silkscreen text keeps its layer, rewording it draws a new glyph and frees the old one", () => {
	const { builder, shapes, label, drawn, freed } = boardWithText();
	const first = builder.build(shapes);
	const texts = layerOf(first, "footprint:F.SilkS:text");
	const before = corners(texts).array.slice();
	const second = builder.build(moved(shapes, 7, 1));
	assert.equal(layerOf(second, "footprint:F.SilkS:text"), texts);
	corners(texts).array.forEach((value, index) => {
		const shift = index % 3 === 0 ? 1 : 0;
		assert.ok(Math.abs(value - before[index] - shift) < 1e-6);
	});
	builder.release(second);
	assert.deepEqual(freed, []);

	const reworded = shapes.map((shape) =>
		shape.id === 7 ? { ...label, text: "R1" } : shape,
	);
	const third = builder.build(reworded);
	assert.notEqual(layerOf(third, "footprint:F.SilkS:text"), texts);
	assert.ok(drawn.includes("R1"));
	assert.deepEqual(freed, []);
	builder.release(third);
	assert.deepEqual(freed, [label.kind === "text" ? label.text : ""]);
	builder.dispose();
	assert.deepEqual([...freed].sort(), [...drawn].sort());
});

test("a zone fill draws from the triangles it arrives with and stays put while a pad is dragged over it", () => {
	const builder = createBoardBuilder(createBoardObjects());
	const shapes = twoPadsAHoleAndSilk();
	const pour = (size = 5): BoardRegion => ({
		layer: "F.Cu",
		polygons: [
			[
				[
					[-size, -size],
					[size, -size],
					[size, size],
					[-size, size],
				],
			],
		],
		triangles: new Float32Array([
			-size,
			-size,
			size,
			-size,
			size,
			size,
			-size,
			-size,
			size,
			size,
			-size,
			size,
		]),
	});
	const regions = [pour()];
	const copper = layerOf(builder.build(shapes, { regions }), "footprint:F.Cu");
	assert.equal(copper.objects.length, 4);
	const filled = positions(copper.object).array.slice(0, 18);
	assert.deepEqual(
		[...filled],
		[-5, -5, 0, 5, -5, 0, 5, 5, 0, -5, -5, 0, 5, 5, 0, -5, 5, 0],
	);
	const unpoured = layerOf(
		createBoardBuilder(createBoardObjects()).build(shapes),
		"footprint:F.Cu",
	);
	assert.equal(
		positions(copper.object, "walls").count -
			positions(unpoured.object, "walls").count,
		4 * 6,
	);

	const dragged = builder.build(moved(shapes, 2, 2.4), { regions });
	assert.equal(layerOf(dragged, "footprint:F.Cu"), copper);
	const [range] = positions(copper.object).updateRanges;
	assert.ok(range.start >= 18);
	assert.deepEqual(positions(copper.object).array.slice(0, 18), filled);

	const refilled = builder.build(moved(shapes, 2, 2.4), {
		regions: [pour(4)],
	});
	assert.equal(layerOf(refilled, "footprint:F.Cu"), copper);
	assert.equal(positions(copper.object).array[0], -4);

	const island: BoardRegion = {
		...pour(4),
		polygons: [...pour(4).polygons, ...pour(1).polygons],
		triangles: new Float32Array([
			...required(pour(4).triangles),
			...required(pour(1).triangles),
		]),
	};
	const split = layerOf(
		builder.build(moved(shapes, 2, 2.4), { regions: [island] }),
		"footprint:F.Cu",
	);
	assert.notEqual(split, copper);
	assert.equal(
		positions(split.object).count - positions(copper.object).count,
		6,
	);
	const untriangulated = layerOf(
		builder.build(moved(shapes, 2, 2.4), {
			regions: [{ ...island, triangles: undefined }],
		}),
		"footprint:F.Cu",
	);
	assert.equal(
		positions(untriangulated.object).count,
		positions(split.object).count,
	);
	builder.dispose();
});
