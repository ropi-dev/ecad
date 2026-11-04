import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
	placeShapesEffect,
	redoEffect,
	replaceShapesEffect,
	undoEffect,
} from "#/commands/drawing-commands.ts";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import {
	type EditorSymbol,
	moveSymbolText,
	pinTerminals,
	symbolTextShapes,
} from "#/drawing/shapes.ts";
import {
	persistDrawingShapes,
	resolveDrawingSymbols,
} from "#/drawing/symbol-persistence.ts";
import { symbolReferenceKey } from "#/drawing/symbol-reference.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "./helpers/required.ts";

const definition = symbolDefinitions[0];

test("each instance owns its label centers and moving rotated text snaps in world coordinates", () => {
	const first = {
		...createSymbol(1, definition, { x: 20, y: 30 }),
		rotation: Math.PI / 2,
	};
	const second = createSymbol(2, definition, { x: 60, y: 30 });
	const before = symbolTextShapes(first);
	const moved = moveSymbolText(first, 0, { x: 7.3, y: -4.1 }, 1);
	const after = symbolTextShapes(moved);
	assert.equal(after[0].x, Math.round(before[0].x + 7.3));
	assert.equal(after[0].y, Math.round(before[0].y - 4.1));
	assert.deepEqual(after[1], before[1]);
	assert.deepEqual(pinTerminals(moved), pinTerminals(first));
	assert.equal(moved.x, first.x);
	assert.equal(moved.y, first.y);
	assert.deepEqual(first.textPositions, second.textPositions);
	assert.notStrictEqual(
		required(first.textPositions).reference,
		required(second.textPositions).reference,
	);
	assert.deepEqual(moved.children, first.children);
	assert.deepEqual(definition.texts, first.texts);
	const display = required(
		buildDrawingDisplay([moved], new Set()).shapes[0].children,
	)[0];
	assert.equal(
		display.x * moved.width,
		required(required(moved.textPositions).reference).x,
	);
});

test("instance positions survive serialization and definition changes while legacy drawings use defaults", () => {
	const instance = moveSymbolText(
		createSymbol(1, definition, { x: 20, y: 30 }),
		0,
		{ x: 8, y: 4 },
	);
	const saved = persistDrawingShapes([instance])[0];
	assert.ok(!("children" in saved));
	assert.ok(!("texts" in saved));
	const restored = drawingShapeSchema.parse(JSON.parse(JSON.stringify(saved)));
	assert.equal(restored.kind, "symbol");
	if (restored.kind !== "symbol") throw new Error("Expected symbol");
	const updated = {
		...definition,
		texts: definition.texts.map((text) => ({ ...text, x: text.x + 20 })),
	};
	const references = new Map([
		[symbolReferenceKey(required(definition.library), definition.id), updated],
	]);
	const result = resolveDrawingSymbols([restored], [updated], references)
		.shapes[0] as EditorSymbol;
	assert.deepEqual(symbolTextShapes(result), symbolTextShapes(instance));
	const { textPositions: _positions, ...legacy } = restored;
	const old = resolveDrawingSymbols([legacy], [updated], references)
		.shapes[0] as EditorSymbol;
	assert.equal(symbolTextShapes(old)[0].x, old.x + updated.texts[0].x);
	const hidden = {
		...result,
		attributes: { ...result.attributes, reference: "" },
	};
	assert.equal(symbolTextShapes(hidden).length, 1);
	assert.deepEqual(hidden.textPositions, instance.textPositions);
});

test("position edits create one history step and reject invalid positions atomically", () => {
	const store = createDrawingStore();
	const run = <A, E>(program: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(program.pipe(Effect.provideService(DrawingStore, store)));
	const instance = createSymbol(1, definition, { x: 10, y: 10 });
	run(placeShapesEffect([instance], "Place symbol"));
	const before = store.getSnapshot();
	const moved = moveSymbolText(instance, 0, { x: 8, y: 4 });
	run(replaceShapesEffect([moved], "Move symbol text"));
	assert.equal(
		store.getSnapshot().history.currentId,
		before.history.currentId + 1,
	);
	assert.deepEqual(store.getSnapshot().shapes, [moved]);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [instance]);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [moved]);
	const after = store.getSnapshot();
	for (const textPositions of [
		null,
		[],
		{ reference: { x: NaN, y: 0 } },
		{ value: { x: 0, y: Infinity } },
		{ bad: { x: 0, y: 0 } },
	]) {
		const invalid = { ...moved, textPositions } as unknown as EditorSymbol;
		assert.ok(
			Either.isLeft(
				run(Effect.either(replaceShapesEffect([invalid], "Invalid"))),
			),
		);
		assert.strictEqual(store.getSnapshot(), after);
		assert.equal(drawingShapeSchema.safeParse(invalid).success, false);
	}
});

test("nested symbol placements retain their label positions when their file is edited", async () => {
	const { symbolFileShapes, symbolFileWithShapes } = await import(
		"#/drawing/symbol-file.ts"
	);
	const { parseSymbolFile } = await import(
		"#/components/editor/symbolFormat.ts"
	);
	const file = parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "nested-labels",
			name: "Nested labels",
			description: "",
			prefix: "U",
			value: "",
			shapes: [
				{
					kind: "symbol",
					library: definition.library,
					definitionId: definition.id,
					x: 0,
					y: 0,
					textPositions: { reference: { x: 18, y: 8 } },
				},
			],
		}),
	);
	const shapes = symbolFileShapes(file, () => definition);
	const moved = moveSymbolText(shapes[0] as EditorSymbol, 0, { x: 2, y: 3 });
	const saved = parseSymbolFile(
		JSON.stringify(symbolFileWithShapes(file, [moved])),
	);
	const restored = symbolFileShapes(saved, () => definition)[0] as EditorSymbol;
	assert.deepEqual(restored.textPositions, moved.textPositions);
	assert.deepEqual(symbolTextShapes(restored), symbolTextShapes(moved));
});
