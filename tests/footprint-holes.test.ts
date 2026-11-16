import assert from "node:assert/strict";
import { test } from "node:test";
import { editorShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	type EditorShape,
	editShapeAttribute,
	shapeAt,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	createHole,
	createPad,
	createVia,
	footprintLayerView,
	isHole,
	setShapeLayer,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { maskOpenings } from "#/board/gerber.ts";
import { pasteSelection } from "#/drawing/clipboard.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { applySelectionEdit } from "#/drawing/selection-edit.ts";
import { realisticLayerStyle } from "#/engine/realistic-board.ts";
import {
	boardObjectVisible,
	DRILL_LAYER_ID,
	NPTH_LAYER_ID,
	planFootprintBoard,
} from "#/footprint/board.ts";
import {
	createEmptyFootprintFile,
	footprintFileSchema,
	footprintFileWithShapes,
} from "#/footprint/format.ts";
import { isUnplatedDrillLayer } from "#/formats/gerber/board-stack.ts";
import { required } from "./helpers/required.ts";

const measure = (text: string) => text.length * 57.6;
const editContext = (selection: EditorShape[]) => ({
	selection,
	shapes: selection,
	nextId: 99,
	allowLocked: false,
	measureText: measure,
});

test("a new unplated hole is a 3.2 mm drill with a mask opening its size on both sides", () => {
	const hole = createHole(1, { x: 1, y: 2 });
	assert.equal(editorShapeSchema.safeParse(hole).success, true);
	assert.deepEqual(
		[hole.kind, hole.x, hole.y, hole.width, hole.hole.drill],
		["circle", 1, 2, 3.2, 3.2],
	);
	const masks = new Set<FootprintLayer>(["F.Mask", "B.Mask"]);
	const copper = new Set<FootprintLayer>(["F.Cu", "B.Cu"]);
	assert.deepEqual(footprintLayerView([hole], copper), [hole]);
	assert.deepEqual(footprintLayerView([hole], masks), []);
});

test("the schema accepts an unplated hole only on a circle that is not a pad or via, with a drill no larger than the circle", () => {
	const hole = createHole(1, { x: 0, y: 0 });
	const pad = createPad(2, { x: 0, y: 0 }, "through-hole", "1", "F.Cu");
	const via = createVia(3, { x: 0, y: 0 });
	const rejected = [
		{ ...hole, hole: { drill: 3.3 } },
		{ ...hole, kind: "rectangle" as const },
		{ ...pad, hole: { drill: 0.5 } },
		{ ...via, hole: { drill: 0.3 } },
	];
	for (const shape of rejected)
		assert.equal(editorShapeSchema.safeParse(shape).success, false);
	assert.equal(
		editorShapeSchema.safeParse({ ...hole, hole: { drill: 2.75 } }).success,
		true,
	);
});

test("a larger drill widens the mask opening, and shrinking the opening shrinks the drill", () => {
	const hole = createHole(1, { x: 0, y: 0 });
	const edit = (drill: number) =>
		required(
			applySelectionEdit({ kind: "hole-drill", drill }, editContext([hole])),
		).replacements[0];
	const narrowed = edit(2.75);
	assert.ok(isHole(narrowed));
	assert.deepEqual([narrowed.width, narrowed.hole.drill], [3.2, 2.75]);
	const widened = edit(4);
	assert.ok(isHole(widened));
	assert.deepEqual(
		[widened.width, widened.height, widened.hole.drill],
		[4, 4, 4],
	);
	assert.equal(edit(0), hole);
	const shrunk = editShapeAttribute(hole, "radius", 1);
	assert.equal(editorShapeSchema.safeParse(shrunk).success, true);
	assert.ok(isHole(shrunk) && shrunk.hole.drill === 2);
});

test("an unplated hole stays through the board, is never hollow and carries no net", () => {
	const hole = createHole(1, { x: 0, y: 0 });
	assert.equal(setShapeLayer(hole, "F.Cu"), hole);
	assert.deepEqual(
		required(
			applySelectionEdit({ kind: "fill", filled: false }, editContext([hole])),
		).replacements,
		[],
	);
	assert.deepEqual(
		required(
			applySelectionEdit({ kind: "net", net: "gnd" }, editContext([hole])),
		).replacements,
		[],
	);
	assert.equal(shapeAt([hole], { x: 0.5, y: 0 }, 0.01)?.id, 1);
});

test("the display draws an unplated hole as its mask opening with the drill inside and its edge on top", () => {
	const hole = { ...createHole(1, { x: 0, y: 0 }), hole: { drill: 2.75 } };
	const [shape] = buildDrawingDisplay([hole], new Set(), [], measure).shapes;
	assert.equal(shape.appearance, "F.Mask");
	assert.deepEqual(shape.geometry, {
		kind: "circle",
		width: 3.2,
		height: 3.2,
		lineWidth: 0,
		filled: true,
	});
	assert.deepEqual(
		shape.children?.map((child) => [child.name, child.appearance]),
		[
			["unplated hole 1", "pad-hole"],
			["unplated hole edge 1", "F.Mask"],
		],
	);
	assert.ok(
		Math.abs(required(shape.children?.[0]).width * shape.width - 2.75) < 1e-9,
	);
});

test("the 3D board drills an unplated hole without plating and opens both masks", () => {
	const via = createVia(6, { x: -3, y: 0 });
	const hole = { ...createHole(7, { x: 1, y: -1 }), hole: { drill: 2.75 } };
	const board = planFootprintBoard([via, hole]).map((plan) => plan.build());
	assert.deepEqual(
		board.map((layer) => [layer.id, layer.objects.length]),
		[
			["footprint:board", 1],
			["footprint:F.Cu", 1],
			["footprint:B.Cu", 1],
			["footprint:F.Mask", 1],
			["footprint:B.Mask", 1],
			[DRILL_LAYER_ID, 1],
			[NPTH_LAYER_ID, 1],
		],
	);
	const unplated = required(board.at(-1));
	assert.deepEqual(unplated.objects[0].geometry, {
		type: "circle",
		x: 1,
		y: -1,
		radius: 1.375,
	});
	assert.equal(isUnplatedDrillLayer(unplated), true);
	assert.equal(isUnplatedDrillLayer(required(board.at(-2))), false);
	assert.notEqual(
		realisticLayerStyle("drill", true).color,
		realisticLayerStyle("drill").color,
	);
	assert.equal(
		boardObjectVisible(NPTH_LAYER_ID, new Set(["F.Cu", "B.Cu"])),
		true,
	);
	assert.equal(
		boardObjectVisible(NPTH_LAYER_ID, new Set(["F.Mask", "B.Mask"])),
		false,
	);
	const { top, bottom } = maskOpenings([hole]);
	assert.deepEqual([top.length, bottom.length], [1, 1]);
});

test("footprint files keep unplated holes, and a hole pasted into a schematic becomes a plain circle", () => {
	const empty = createEmptyFootprintFile("Mounting", []);
	const file = footprintFileWithShapes(empty, [createHole(1, { x: 0, y: 0 })]);
	assert.deepEqual(footprintFileSchema.parse(structuredClone(file)), file);
	const [pasted] = pasteSelection(
		[createHole(1, { x: 0, y: 0 })],
		[],
		1,
		{ x: 0, y: 0 },
		"drawing",
	);
	assert.deepEqual(
		["hole" in pasted, "filled" in pasted, pasted.layer],
		[false, false, undefined],
	);
});
