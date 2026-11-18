import assert from "node:assert/strict";
import test from "node:test";
import { drawingShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	boxBorder,
	type EditorShape,
	type EditorSymbol,
	editShapeAttribute,
	hitShape,
	replaceSymbolChild,
	resizeHandles,
	resizeShape,
	shapeBounds,
	symbolChildren,
	symbolChildWorld,
	symbolSelectionFrame,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { symbolReferenceKey } from "@ecad/drawing-core/drawing/symbol-reference.ts";
import { fromMils } from "@ecad/drawing-core/drawing/units.ts";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import {
	symbolFileShapes,
	symbolFileWithShapes,
} from "#/drawing/symbol-file.ts";
import {
	persistDrawingShapes,
	resolveDrawingSymbols,
} from "#/drawing/symbol-persistence.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "./helpers/required.ts";

const definition = required(symbolDefinitions.find(({ id }) => id === "box"));
const asSymbol = (shape: EditorShape): EditorSymbol => {
	if (shape.kind !== "symbol") throw new Error("Expected symbol");
	return shape;
};

function assertFits(symbol: EditorSymbol) {
	const border = required(boxBorder(symbol)).shape;
	assert.equal(symbol.width, border.width);
	assert.equal(symbol.height, border.height);
	assert.ok(Math.abs(border.x - border.width / 2) < 1e-9);
	assert.ok(Math.abs(border.y + border.height / 2) < 1e-9);
	const world = symbolChildWorld(symbol, border);
	for (const key of ["minX", "maxX", "minY", "maxY"] as const)
		assert.ok(
			Math.abs(shapeBounds(symbol)[key] - shapeBounds(world)[key]) < 1e-9,
		);
	const selection = symbolSelectionFrame(symbol);
	assert.equal(selection.width, border.width);
	assert.equal(selection.height, border.height);
	assert.ok(Math.abs(selection.x - world.x) < 1e-9);
	assert.ok(Math.abs(selection.y - world.y) < 1e-9);
}

test("Box size and selection match its border when placed, edited and rotated", () => {
	for (const rotation of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
		let symbol = { ...createSymbol(1, definition, { x: 20, y: 30 }), rotation };
		assert.equal(symbol.width, fromMils(1000));
		assert.equal(symbol.height, fromMils(600));
		assert.deepEqual(symbolChildren(symbol)[1].shape, {
			...definition.children[1],
			locked: false,
			x: fromMils(50),
			y: fromMils(-50),
			horizontalAlign: "left",
			verticalAlign: "top",
		});
		assertFits(symbol);
		symbol = asSymbol(editShapeAttribute(symbol, "width", 36));
		symbol = asSymbol(editShapeAttribute(symbol, "height", 24));
		assert.equal(symbol.x, 20);
		assert.equal(symbol.y, 30);
		assertFits(symbol);
		const border = required(boxBorder(symbol));
		symbol = replaceSymbolChild(symbol, border.key, {
			...border.shape,
			width: 42,
			height: 28,
			lineStyle: "dashed",
			lineWidth: 0.7,
		});
		assertFits(symbol);
		symbol = asSymbol(editShapeAttribute(symbol, "lineWidth", 0.4));
		assert.equal(required(boxBorder(symbol)).shape.lineWidth, 0.4);
		assert.equal(required(boxBorder(symbol)).shape.lineStyle, "dashed");
		assertFits(symbol);
	}
});

test("Box dimensions survive drawing and nested symbol persistence", () => {
	let symbol = asSymbol(
		editShapeAttribute(
			createSymbol(1, definition, { x: 20, y: 30 }),
			"width",
			36,
		),
	);
	const handle = required(
		resizeHandles(symbol).find((handle) => handle.id === "-1,1"),
	);
	symbol = asSymbol(resizeShape(symbol, handle, { x: -4, y: 3 }));
	const saved = persistDrawingShapes([symbol])[0];
	assert.ok(!("children" in saved));
	const references = new Map([
		[
			symbolReferenceKey(required(definition.library), definition.id),
			definition,
		],
	]);
	const restored = asSymbol(
		resolveDrawingSymbols(
			[drawingShapeSchema.parse(saved)],
			[definition],
			references,
		).shapes[0],
	);
	assert.equal(restored.width, 40);
	assert.equal(restored.height, fromMils(600) + 3);
	assert.deepEqual(symbolChildren(restored)[1], symbolChildren(symbol)[1]);
	assert.equal(symbolChildren(restored)[1].shape.x, fromMils(50));
	assert.equal(symbolChildren(restored)[1].shape.y, fromMils(-50));
	assertFits(restored);
	const file = parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "box-parent",
			name: "Box parent",
			description: "",
			prefix: "U",
			value: "",
			shapes: [],
		}),
	);
	const nested = symbolFileShapes(
		parseSymbolFile(JSON.stringify(symbolFileWithShapes(file, [symbol]))),
		() => definition,
	);
	assertFits(asSymbol(nested[0]));
	assert.equal(nested[0].width, 40);
	assert.deepEqual(
		symbolChildren(asSymbol(nested[0]))[1],
		symbolChildren(symbol)[1],
	);
});

test("Box clicks select text and the outline but pass through the empty interior", () => {
	for (const rotation of [
		0,
		Math.PI / 6,
		Math.PI / 2,
		Math.PI,
		(3 * Math.PI) / 2,
	]) {
		let symbol = { ...createSymbol(1, definition, { x: 20, y: 30 }), rotation };
		symbol = asSymbol(editShapeAttribute(symbol, "width", 36));
		symbol = asSymbol(editShapeAttribute(symbol, "height", 24));
		const border = symbolChildWorld(symbol, required(boxBorder(symbol)).shape);
		const point = (x: number, y: number) => ({
			x: border.x + x * Math.cos(rotation) - y * Math.sin(rotation),
			y: border.y + x * Math.sin(rotation) + y * Math.cos(rotation),
		});
		assert.equal(hitShape(symbol, point(0, 0), 0.5), false);
		assert.equal(hitShape(symbol, point(8, -6), 0.5), false);
		for (const [x, y] of [
			[-18, 0],
			[18, 0],
			[0, -12],
			[0, 12],
			[18, 12],
		]) {
			assert.equal(hitShape(symbol, point(x, y), 0), true);
		}
		assert.equal(hitShape(symbol, point(18.4, 0), 0.5), true);
		assert.equal(hitShape(symbol, point(17.6, 0), 0.5), true);
		assert.equal(hitShape(symbol, point(18.6, 0), 0.5), false);
		assert.equal(hitShape(symbol, point(17.4, 0), 0.5), false);
		const text = symbolChildWorld(symbol, symbolChildren(symbol)[1].shape);
		const bounds = shapeBounds(text);
		assert.equal(
			hitShape(
				symbol,
				{
					x: (bounds.minX + bounds.maxX) / 2,
					y: (bounds.minY + bounds.maxY) / 2,
				},
				0,
			),
			true,
		);
	}
});
