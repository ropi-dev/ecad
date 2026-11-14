import assert from "node:assert/strict";
import { test } from "node:test";
import { editorShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	type EditorShape,
	editShapeAttribute,
	resizeHandles,
	resizeShape,
	shapeAt,
	snappedMoveDelta,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	createPad,
	createVia,
	footprintLayerView,
	isVia,
	setShapeLayer,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { pasteSelection } from "#/drawing/clipboard.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { applySelectionEdit } from "#/drawing/selection-edit.ts";
import { DRILL_LAYER_ID, planFootprintBoard } from "#/footprint/board.ts";
import {
	createEmptyFootprintFile,
	footprintFileSchema,
	footprintFileWithShapes,
} from "#/footprint/format.ts";
import { required } from "./helpers/required.ts";

const measure = (text: string) => text.length * 57.6;
const editContext = (selection: EditorShape[]) => ({
	selection,
	shapes: selection,
	nextId: 99,
	allowLocked: false,
	measureText: measure,
});

test("a new via is a 0.6 mm circle with a 0.3 mm drill on both copper layers", () => {
	const via = createVia(1, { x: 1, y: 2 });
	assert.equal(editorShapeSchema.safeParse(via).success, true);
	assert.deepEqual(
		[via.kind, via.x, via.y, via.width, via.via.drill],
		["circle", 1, 2, 0.6, 0.3],
	);
	const back = new Set<FootprintLayer>(["B.Cu"]);
	const both = new Set<FootprintLayer>(["F.Cu", "B.Cu"]);
	assert.deepEqual(footprintLayerView([via], back), [via]);
	assert.deepEqual(footprintLayerView([via], both), []);
});

test("the schema accepts a via only on a circle that is not a pad, with a drill smaller than the circle", () => {
	const via = createVia(1, { x: 0, y: 0 });
	const pad = createPad(2, { x: 0, y: 0 }, "through-hole", "1", "F.Cu");
	const rejected = [
		{ ...via, via: { drill: 0.6 } },
		{ ...via, kind: "rectangle" as const },
		{ ...pad, via: { drill: 0.3 } },
	];
	for (const shape of rejected)
		assert.equal(editorShapeSchema.safeParse(shape).success, false);
});

test("a via's drill edit keeps it smaller than the via, and shrinking the via shrinks its drill", () => {
	const via = createVia(1, { x: 0, y: 0 });
	const edit = (drill: number) =>
		required(
			applySelectionEdit({ kind: "via-drill", drill }, editContext([via])),
		).replacements[0];
	const widened = edit(0.4);
	assert.ok(isVia(widened) && widened.via.drill === 0.4);
	assert.equal(edit(0.6), via);
	assert.equal(edit(0), via);
	const byAttribute = editShapeAttribute(via, "radius", 0.1);
	const byHandle = resizeShape(via, required(resizeHandles(via)[0]), {
		x: 0.1,
		y: 0,
	});
	for (const shrunk of [byAttribute, byHandle]) {
		assert.equal(editorShapeSchema.safeParse(shrunk).success, true);
		assert.ok(isVia(shrunk) && shrunk.via.drill < shrunk.width);
	}
});

test("a via stays on both copper layers, is never hollow, and keeps its centre on the grid", () => {
	const via = createVia(1, { x: 0, y: 0 });
	assert.equal(setShapeLayer(via, "F.SilkS"), via);
	assert.equal(setShapeLayer(via, "B.Cu"), via);
	const fill = required(
		applySelectionEdit({ kind: "fill", filled: false }, editContext([via])),
	);
	assert.deepEqual(fill.replacements, []);
	assert.equal(shapeAt([via], { x: 0.05, y: 0 }, 0.01)?.id, 1);
	assert.deepEqual(snappedMoveDelta(via, { x: 0.96, y: 1.04 }, 0.5), {
		x: 1,
		y: 1,
	});
});

test("the display draws a via as solid copper with its hole and no number", () => {
	const via = createVia(1, { x: 0, y: 0 });
	const display = buildDrawingDisplay([via], new Set(), [], measure);
	const [shape] = display.shapes;
	assert.equal(shape.appearance, "via");
	assert.deepEqual(shape.geometry, {
		kind: "circle",
		width: 0.6,
		height: 0.6,
		lineWidth: 0,
		filled: true,
	});
	assert.deepEqual(
		shape.children?.map((child) => [child.name, child.appearance]),
		[["via hole 1", "pad-hole"]],
	);
	assert.ok(
		Math.abs(required(shape.children?.[0]).width * shape.width - 0.3) < 1e-9,
	);
});

test("the board puts a via's copper on both sides and drills it", () => {
	const via = createVia(7, { x: 1, y: -1 });
	const board = planFootprintBoard([via]).map((plan) => plan.build());
	assert.deepEqual(
		board.map((layer) => [layer.id, layer.objects.length]),
		[
			["footprint:board", 1],
			["footprint:F.Cu", 1],
			["footprint:B.Cu", 1],
			[DRILL_LAYER_ID, 1],
		],
	);
	const drill = required(board.at(-1)?.objects[0]);
	assert.deepEqual(drill.geometry, {
		type: "circle",
		x: 1,
		y: -1,
		radius: 0.15,
	});
	const copper = required(board[1]?.objects[0]);
	assert.deepEqual(copper.geometry, {
		type: "circle",
		x: 0,
		y: 0,
		radius: 0.3,
	});
});

test("footprint files keep vias, and a via pasted into a schematic becomes a plain circle", () => {
	const empty = createEmptyFootprintFile("Thermal", []);
	const file = footprintFileWithShapes(empty, [createVia(1, { x: 0, y: 0 })]);
	assert.deepEqual(footprintFileSchema.parse(structuredClone(file)), file);
	const [pasted] = pasteSelection(
		[createVia(1, { x: 0, y: 0 })],
		[],
		1,
		{ x: 0, y: 0 },
		"drawing",
	);
	assert.deepEqual(
		["via" in pasted, "filled" in pasted, pasted.layer],
		[false, false, undefined],
	);
});
