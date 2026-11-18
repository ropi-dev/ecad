import assert from "node:assert/strict";
import { test } from "node:test";
import {
	placeShapesEffect,
	redoEffect,
	replaceShapesEffect,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { drawingShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	type EditorSymbol,
	moveSymbolText,
	pinTerminals,
	symbolTextShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { Effect, Either } from "effect";
import { buildDrawingDisplay } from "#/drawing/display.ts";
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
