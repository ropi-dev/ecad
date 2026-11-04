import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
	createSymbolFromSelectionEffect,
	placeShapesEffect,
	redoEffect,
	replaceShapesEffect,
	undoEffect,
} from "#/commands/drawing-commands.ts";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store.ts";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import {
	containsSelection,
	type EditorSymbol,
	hitShape,
	resizeHandles,
	resizeShape,
	shapeBounds,
	symbolShapes,
	symbolTextShapes,
	type TextShape,
} from "#/drawing/shapes.ts";
import {
	libraryDefinitions,
	symbolFileShapes,
	symbolFileWithShapes,
} from "#/drawing/symbol-file.ts";
import {
	persistDrawingShapes,
	resolveDrawingSymbols,
} from "#/drawing/symbol-persistence.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import {
	horizontalAlignments,
	textCenter,
	verticalAlignments,
} from "#/drawing/text-alignment.ts";
import { required } from "./helpers/required.ts";

const text: TextShape = {
	id: 1,
	kind: "text",
	text: "Two lines\nshort",
	x: 10,
	y: 20,
	width: 12,
	height: 6,
	rotation: 0,
	lineWidth: 0.2,
	fontSize: 2,
};

function session() {
	const store = createDrawingStore();
	const run = <A, E>(effect: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(effect.pipe(Effect.provideService(DrawingStore, store)));
	return { store, run };
}

test("all alignments share their rendered bounds with selection, hit testing and resize handles", () => {
	for (const rotation of [0, Math.PI / 2, Math.PI / 5])
		for (const horizontalAlign of horizontalAlignments)
			for (const verticalAlign of verticalAlignments) {
				const shape = { ...text, horizontalAlign, verticalAlign, rotation };
				const center = textCenter(shape);
				const display = buildDrawingDisplay([shape], new Set([shape.id]));
				assert.equal(display.shapes[0].x, center.x);
				assert.equal(display.shapes[0].y, center.y);
				assert.equal(display.selections[0].x, center.x);
				assert.equal(display.selections[0].y, center.y);
				assert.ok(hitShape(shape, center, 0));
				const bounds = shapeBounds(shape);
				assert.ok(containsSelection(shape, bounds));
				const handles = resizeHandles(shape);
				assert.ok(
					Math.abs(
						handles.reduce((sum, handle) => sum + handle.x, 0) / 4 - center.x,
					) < 1e-9,
				);
				const resized = resizeShape(shape, handles[3], { x: 5, y: 3 });
				const fixedBefore = handles[0];
				const fixedAfter = resizeHandles(resized)[0];
				assert.ok(Math.abs(fixedBefore.x - fixedAfter.x) < 1e-9);
				assert.ok(Math.abs(fixedBefore.y - fixedAfter.y) < 1e-9);
			}
	assert.deepEqual(
		textCenter({ ...text, horizontalAlign: "left", verticalAlign: "top" }),
		{ x: 16, y: 17 },
	);
	assert.deepEqual(
		textCenter({ ...text, horizontalAlign: "right", verticalAlign: "bottom" }),
		{ x: 4, y: 23 },
	);
	assert.deepEqual(textCenter(text), { x: 10, y: 20 });
});

test("alignment-only edits create history and reject invalid values atomically", () => {
	const { store, run } = session();
	run(placeShapesEffect([text], "Text"));
	const aligned = {
		...text,
		horizontalAlign: "right",
		verticalAlign: "bottom",
	} as const;
	run(replaceShapesEffect([aligned], "Align"));
	assert.deepEqual(store.getSnapshot().shapes, [aligned]);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [text]);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [aligned]);
	const before = store.getSnapshot();
	for (const value of ["start", "", null, 2]) {
		const invalid = {
			...aligned,
			horizontalAlign: value,
		} as unknown as TextShape;
		assert.ok(
			Either.isLeft(
				run(Effect.either(replaceShapesEffect([invalid], "Invalid"))),
			),
		);
		assert.strictEqual(store.getSnapshot(), before);
		assert.equal(drawingShapeSchema.safeParse(invalid).success, false);
	}
});

test("symbol label alignment survives saving, resolution, rotation and nested files", () => {
	const definition = symbolDefinitions[0];
	const first = createSymbol(1, definition, { x: 30, y: 40 });
	const aligned: EditorSymbol = {
		...first,
		rotation: Math.PI / 2,
		textAlignments: {
			reference: { horizontalAlign: "left", verticalAlign: "top" },
		},
	};
	const saved = drawingShapeSchema.parse(
		JSON.parse(JSON.stringify(persistDrawingShapes([aligned])[0])),
	);
	const restored = resolveDrawingSymbols(
		[saved],
		[],
		new Map([
			[`user:${required(definition.library).id}:${definition.id}`, definition],
		]),
	).shapes[0] as EditorSymbol;
	assert.deepEqual(restored.textAlignments, aligned.textAlignments);
	assert.equal(symbolTextShapes(first)[0].horizontalAlign, undefined);
	const label = symbolTextShapes(aligned)[0];
	assert.equal(label.horizontalAlign, "left");
	const center = textCenter(label);
	assert.ok(hitShape(aligned, center, 0));
	const display = buildDrawingDisplay([aligned], new Set()).shapes[0];
	const child = required(display.children)[0];
	const worldX = aligned.x - child.y * aligned.height;
	const worldY = aligned.y + child.x * aligned.width;
	assert.ok(Math.abs(worldX - center.x) < 1e-9);
	assert.ok(Math.abs(worldY - center.y) < 1e-9);
	const file = parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "label-parent",
			name: "Label parent",
			description: "",
			prefix: "U",
			value: "",
			shapes: [],
		}),
	);
	const nested = parseSymbolFile(
		JSON.stringify(symbolFileWithShapes(file, [aligned])),
	);
	const nestedShape = symbolFileShapes(
		nested,
		() => definition,
	)[0] as EditorSymbol;
	assert.deepEqual(nestedShape.textAlignments, aligned.textAlignments);
});

test("text can be grouped, saved and resolved as reusable symbol geometry", () => {
	const { run, store } = session();
	const aligned = {
		...text,
		horizontalAlign: "left",
		verticalAlign: "top",
	} as const;
	run(placeShapesEffect([aligned, { ...text, y: 30 }], "Labels"));
	run(createSymbolFromSelectionEffect([1, 2]));
	const symbol = store.getSnapshot().shapes[0] as EditorSymbol;
	assert.deepEqual(
		symbolShapes(symbol).map(({ id: _id, ...shape }) => shape),
		[aligned, { ...text, y: 30 }].map(({ id: _id, ...shape }) => shape),
	);
	const file = parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "static-labels",
			name: "Static labels",
			description: "",
			prefix: "U",
			value: "",
			shapes: [],
		}),
	);
	const saved = parseSymbolFile(
		JSON.stringify(symbolFileWithShapes(file, symbol.children)),
	);
	const definition = libraryDefinitions([saved])[0];
	const instance = createSymbol(5, definition, { x: 0, y: 0 });
	assert.equal(instance.children[0].kind, "text");
	assert.equal((instance.children[0] as TextShape).horizontalAlign, "left");
	const display = buildDrawingDisplay([instance], new Set());
	assert.equal(display.connections.length, 2);
	assert.equal(display.connections[0].text, aligned.text);
	assert.deepEqual(symbolFileShapes(saved), symbol.children);
});

for (const electrical of ["net", "supply"] as const) {
	test(`${electrical} labels have no resize handles and ignore resize gestures`, () => {
		const label = { ...text, electrical };
		assert.deepEqual(resizeHandles(label), []);
		assert.equal(
			resizeShape(label, resizeHandles(text)[3], { x: 5, y: 3 }),
			label,
		);
	});
}
