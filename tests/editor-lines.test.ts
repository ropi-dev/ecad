import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
	createSymbolFromSelectionEffect,
	placeShapesEffect,
	redoEffect,
	undoEffect,
} from "#/commands/drawing-commands.ts";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store.ts";
import {
	libraryDefinitions,
	parseSymbolFile,
	symbolFileFromSymbol,
} from "#/components/editor/symbolFormat.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import {
	drawShape,
	editShapeAttribute,
	hitShape,
	intersectsSelection,
	moveShapes,
	normalizeWireSegments,
	resizeHandles,
	resizeShape,
	symbolShapes,
	wireConnectionPoints,
} from "#/drawing/shapes.ts";
import { createSymbol, createSymbolFromShapes } from "#/drawing/symbols.ts";
import { createShapeGeometry } from "#/engine/drawing/shapeGeometry.ts";
import { drawingShapeSchema } from "#/mcp/drawing-protocol.ts";
import { required } from "./helpers/required.ts";

const close = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("lines keep both endpoints at arbitrary angles, with optional grid snapping", () => {
	const line = drawShape(1, "line", { x: 10, y: 20 }, { x: 40, y: 60 });
	close(line.width, 50);
	close(line.rotation, Math.atan2(40, 30));
	const handles = resizeHandles(line);
	assert.equal(handles.length, 2);
	close(handles[0].x, 10);
	close(handles[0].y, 20);
	close(handles[1].x, 40);
	close(handles[1].y, 60);
	assert.equal(hitShape(line, { x: 25, y: 40 }, 0.1), true);
	assert.equal(hitShape(line, { x: 10, y: 50 }, 0.1), false);
	assert.equal(
		intersectsSelection(line, { minX: 24, maxX: 26, minY: 39, maxY: 41 }),
		true,
	);
	assert.equal(
		intersectsSelection(line, { minX: 10, maxX: 12, minY: 50, maxY: 52 }),
		false,
	);
	const snapped = drawShape(2, "line", { x: 13, y: 17 }, { x: 42, y: 64 }, 10);
	const ends = resizeHandles(snapped);
	close(ends[0].x, 10);
	close(ends[0].y, 20);
	close(ends[1].x, 40);
	close(ends[1].y, 60);
});

test("line endpoint resizing anchors the other endpoint and allows arbitrary rotation", () => {
	const line = drawShape(1, "line", { x: 10, y: 20 }, { x: 40, y: 60 });
	for (const index of [0, 1]) {
		const handles = resizeHandles(line);
		const resized = resizeShape(line, handles[index], { x: 13, y: -17 }, 10);
		const ends = resizeHandles(resized);
		close(ends[1 - index].x, handles[1 - index].x);
		close(ends[1 - index].y, handles[1 - index].y);
		close(ends[index].x, index === 0 ? 20 : 50);
		close(ends[index].y, index === 0 ? 0 : 40);
	}
	close(editShapeAttribute(line, "angle", 37).rotation, (37 * Math.PI) / 180);
	close(editShapeAttribute(line, "width", 12).width, 12);
	assert.deepEqual(editShapeAttribute(line, "height", 12), line);
});

test("lines do not merge or connect to wires, and their render width follows the stroke", () => {
	const wire = drawShape(1, "wire", { x: 0, y: 0 }, { x: 20, y: 0 });
	const line = {
		...drawShape(2, "line", { x: 20, y: 0 }, { x: 40, y: 0 }),
		lineWidth: 0.7,
	};
	const overlap = { ...line, id: 3 };
	assert.deepEqual(normalizeWireSegments([wire, line, overlap]).shapes, [
		wire,
		line,
		overlap,
	]);
	assert.deepEqual(wireConnectionPoints([line]), []);
	assert.deepEqual(
		wireConnectionPoints([wire, line]),
		wireConnectionPoints([wire]),
	);
	assert.deepEqual(moveShapes([line], { x: 3, y: 4 }, 0, line, [wire, line]), [
		{ ...line, x: line.x + 3, y: line.y + 4 },
	]);
	assert.deepEqual(moveShapes([wire], { x: 3, y: 4 }, 0, wire, [wire, line]), [
		{ ...wire, x: wire.x + 3, y: wire.y + 4 },
	]);
	const display = buildDrawingDisplay([line], new Set());
	assert.equal(display.shapes[0].height, 0.7);
	assert.deepEqual(display.terminals, []);
	const geometry = createShapeGeometry(display.shapes[0].geometry).scale(
		line.width,
		display.shapes[0].height,
		1,
	);
	try {
		geometry.computeBoundingBox();
		assert.ok(
			Math.abs(
				required(geometry.boundingBox).max.y -
					required(geometry.boundingBox).min.y -
					0.7,
			) < 1e-6,
		);
	} finally {
		geometry.dispose();
	}
});

test("lines pass command and protocol validation and group into undoable symbols", () => {
	const store = createDrawingStore();
	const run = <A, E>(program: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(program.pipe(Effect.provideService(DrawingStore, store)));
	const line = drawShape(1, "line", { x: 10, y: 20 }, { x: 40, y: 60 });
	assert.equal(drawingShapeSchema.safeParse(line).success, true);
	run(placeShapesEffect([line, { ...line, id: 2, x: 80 }], "Draw lines"));
	const original = store.getSnapshot();
	assert.ok(
		Either.isLeft(
			run(
				Effect.either(placeShapesEffect([{ ...line, width: 0 }], "Empty line")),
			),
		),
	);
	assert.strictEqual(store.getSnapshot(), original);
	run(createSymbolFromSelectionEffect([1, 2]));
	const grouped = store.getSnapshot().shapes[0];
	assert.equal(grouped.kind, "symbol");
	if (grouped.kind === "symbol")
		assert.deepEqual(symbolShapes(grouped), original.shapes);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, original.shapes);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [grouped]);
});

test("symbol files accept decorative lines and preserve their angles", () => {
	const file = parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "custom.lines",
			name: "Lines",
			description: "",
			prefix: "U",
			value: "",
			shapes: [{ kind: "line", x1: -3, y1: -4, x2: 3, y2: 4 }],
		}),
	);
	const child = libraryDefinitions([file])[0].children[0];
	assert.equal(child.kind, "line");
	close(child.width, 10);
	close(child.rotation, Math.atan2(8, 6));
});

test("saving a named selection preserves its reusable geometry and stroke widths", () => {
	const shapes = [
		{
			...drawShape(1, "line", { x: 10, y: 20 }, { x: 40, y: 60 }),
			lineWidth: 0.8,
		},
		{
			...drawShape(2, "rectangle", { x: 50, y: 20 }, { x: 60, y: 30 }),
			rotation: Math.PI / 6,
			lineWidth: 0.3,
		},
		drawShape(3, "pin", { x: 10, y: 20 }, { x: 10, y: 20 }),
	];
	const original = createSymbolFromShapes(4, shapes, {
		name: "Input connector",
		definitionId: "custom.connector",
	});
	const file = symbolFileFromSymbol(original);
	const definition = libraryDefinitions([
		parseSymbolFile(JSON.stringify(file)),
	])[0];
	const reused = createSymbol(5, definition, { x: original.x, y: original.y });
	assert.equal(reused.attributes.name, "Input connector");
	assert.equal(reused.definitionId, "custom.connector");
	const children = symbolShapes(reused);
	for (let index = 0; index < shapes.length; index++) {
		const expected = shapes[index];
		const actual = children[index];
		assert.equal(actual.kind, expected.kind);
		for (const field of ["x", "y", "width", "rotation", "lineWidth"] as const)
			close(actual[field], expected[field]);
	}
});
