import assert from "node:assert/strict";
import { test } from "node:test";
import { editorShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	type EditorShape,
	editShapeAttribute,
	resizeHandles,
	resizeShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	createVia,
	footprintLayerView,
	isVia,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { pasteSelection } from "#/drawing/clipboard.ts";
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
