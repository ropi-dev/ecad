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
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import {
	canSelectShape,
	canSelectSymbolChild,
	drawShape,
	moveShapes,
	moveSymbolChild,
	normalizeWireSegments,
	replaceSymbolChild,
	symbolChildren,
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
import { symbolReferenceKey } from "#/drawing/symbol-reference.ts";
import {
	createSymbol,
	createSymbolFromShapes,
	symbolDefinitions,
} from "#/drawing/symbols.ts";
import { createTextShape } from "#/drawing/text.ts";
import { required } from "./helpers/required.ts";

const definition = symbolDefinitions[0];

test("non-text symbol children default to locked while text and standalone shapes stay editable", () => {
	const primitives = (
		["rectangle", "circle", "triangle", "line", "wire", "pin"] as const
	).map((kind, index) =>
		drawShape(index + 1, kind, { x: 0, y: 0 }, { x: 5, y: 5 }),
	);
	const text = createTextShape(7, { x: 0, y: 8 }, (value) => value.length * 48);
	const symbol = createSymbolFromShapes(8, [...primitives, text]);
	for (const child of symbolChildren(symbol)) {
		assert.equal(child.shape.locked, child.shape.kind !== "text");
		for (const allowLocked of [false, true]) {
			assert.equal(
				canSelectSymbolChild(symbol, child, allowLocked),
				child.shape.kind === "text",
			);
			const moved = moveSymbolChild(
				symbol,
				child.key,
				{ x: 5, y: 3 },
				0,
				allowLocked,
			);
			if (child.shape.kind === "text") assert.notStrictEqual(moved, symbol);
			else assert.strictEqual(moved, symbol);
		}
	}
	for (const shape of [...primitives, text])
		assert.equal(canSelectShape(shape), true);
	const placed = createSymbol(9, definition, { x: 0, y: 0 });
	for (const child of symbolChildren(placed))
		assert.equal(
			canSelectSymbolChild(placed, child),
			child.shape.kind === "text",
		);
	const moved = moveShapes([placed], { x: 10, y: 20 })[0];
	assert.equal(moved.x, 10);
	assert.equal(moved.y, 20);
});

test("explicit child unlocks and text locks override the defaults and survive saving", () => {
	const symbol = createSymbol(1, definition, { x: 0, y: 0 });
	const child = required(
		symbolChildren(symbol).find((child) => child.shape.kind === "rectangle"),
	);
	const unlocked = replaceSymbolChild(symbol, child.key, {
		...child.shape,
		locked: false,
	});
	const saved = persistDrawingShapes([unlocked])[0];
	const restored = resolveDrawingSymbols(
		[drawingShapeSchema.parse(saved)],
		[definition],
		new Map([
			[
				symbolReferenceKey(required(definition.library), definition.id),
				definition,
			],
		]),
	).shapes[0];
	assert.equal(restored.kind, "symbol");
	if (restored.kind !== "symbol") throw new Error("Expected symbol");
	const body = required(
		symbolChildren(restored).find((item) => item.key === child.key),
	);
	assert.equal(body.shape.locked, false);
	assert.equal(canSelectSymbolChild(restored, body), true);
	assert.notStrictEqual(
		moveSymbolChild(restored, body.key, { x: 5, y: 3 }),
		restored,
	);
	const label = required(
		symbolChildren(restored).find((item) => item.key === "attribute:reference"),
	);
	const locked = replaceSymbolChild(restored, label.key, {
		...label.shape,
		locked: true,
	});
	assert.equal(
		canSelectSymbolChild(
			locked,
			required(symbolChildren(locked).find((item) => item.key === label.key)),
			true,
		),
		false,
	);
});

test("the toolbar override applies to roots while child locks always prevent selection", () => {
	const symbol = createSymbol(1, definition, { x: 0, y: 0 });
	const lockedSymbol = { ...symbol, locked: true };
	const rectangle = {
		...drawShape(2, "rectangle", { x: 0, y: 0 }, { x: 5, y: 5 }),
		locked: true,
	};
	for (const shape of [lockedSymbol, rectangle]) {
		assert.equal(canSelectShape(shape), false);
		assert.equal(canSelectShape(shape, true), true);
	}
	for (const child of symbolChildren(symbol)) {
		assert.equal(
			canSelectSymbolChild(symbol, child),
			child.shape.kind === "text",
		);
		assert.equal(
			canSelectSymbolChild(symbol, child, true),
			child.shape.kind === "text",
		);
		assert.equal(canSelectSymbolChild(lockedSymbol, child), false);
		assert.equal(
			canSelectSymbolChild(lockedSymbol, child, true),
			child.shape.kind === "text",
		);
		assert.equal(
			canSelectSymbolChild(symbol, {
				...child,
				shape: { ...child.shape, locked: true },
			}),
			false,
		);
		assert.equal(
			canSelectSymbolChild(
				symbol,
				{ ...child, shape: { ...child.shape, locked: true } },
				true,
			),
			false,
		);
		assert.equal(
			canSelectSymbolChild(
				lockedSymbol,
				{ ...child, shape: { ...child.shape, locked: true } },
				true,
			),
			false,
		);
	}
	const label = required(
		symbolChildren(lockedSymbol).find(
			(child) => child.key === "attribute:reference",
		),
	);
	assert.strictEqual(
		moveSymbolChild(lockedSymbol, label.key, { x: 5, y: 3 }),
		lockedSymbol,
	);
	assert.notDeepEqual(
		moveSymbolChild(lockedSymbol, label.key, { x: 5, y: 3 }, 0, true)
			.textPositions,
		lockedSymbol.textPositions,
	);
	assert.deepEqual(moveShapes([lockedSymbol], { x: 5, y: 3 }), [lockedSymbol]);
	assert.equal(
		moveShapes(
			[lockedSymbol],
			{ x: 5, y: 3 },
			0,
			lockedSymbol,
			[lockedSymbol],
			2,
			true,
		)[0].x,
		5,
	);
});

test("root and child locks survive reference-only saves, nested symbol files, and undo", () => {
	let symbol = createSymbol(1, definition, { x: 10, y: 20 });
	const label = required(
		symbolChildren(symbol).find((child) => child.key === "attribute:reference"),
	);
	symbol = {
		...replaceSymbolChild(symbol, label.key, { ...label.shape, locked: true }),
		locked: true,
	};
	const saved = persistDrawingShapes([symbol])[0];
	assert.ok(!("children" in saved));
	const restored = resolveDrawingSymbols(
		[drawingShapeSchema.parse(saved)],
		[definition],
		new Map([
			[
				symbolReferenceKey(required(definition.library), definition.id),
				definition,
			],
		]),
	).shapes[0];
	assert.equal(restored.locked, true);
	assert.equal(restored.kind, "symbol");
	if (restored.kind !== "symbol") throw new Error("Expected symbol");
	assert.equal(
		required(symbolChildren(restored).find((child) => child.key === label.key))
			.shape.locked,
		true,
	);
	assert.strictEqual(
		moveSymbolChild(restored, label.key, { x: 5, y: 5 }),
		restored,
	);
	assert.strictEqual(
		moveSymbolChild(restored, label.key, { x: 5, y: 5 }, 0, true),
		restored,
	);
	const emptyFile = parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "locks",
			name: "Locks",
			description: "",
			prefix: "U",
			value: "",
			shapes: [],
		}),
	);
	const nested = parseSymbolFile(
		JSON.stringify(symbolFileWithShapes(emptyFile, [symbol])),
	);
	assert.equal(symbolFileShapes(nested, () => definition)[0].locked, true);
	assert.ok(
		libraryDefinitions([nested], () => definition)[0].children.every(
			(child) => child.locked === true,
		),
	);
	const store = createDrawingStore();
	const run = <A, E>(program: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(program.pipe(Effect.provideService(DrawingStore, store)));
	const unlocked = createSymbol(1, definition, { x: 10, y: 20 });
	run(placeShapesEffect([unlocked], "Place symbol"));
	run(replaceShapesEffect([symbol], "Lock symbol"));
	assert.deepEqual(store.getSnapshot().shapes, [symbol]);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [unlocked]);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [symbol]);
	const before = store.getSnapshot();
	const invalid = { ...symbol, locked: "true" } as unknown as typeof symbol;
	assert.ok(
		Either.isLeft(
			run(Effect.either(replaceShapesEffect([invalid], "Invalid lock"))),
		),
	);
	assert.strictEqual(store.getSnapshot(), before);
	assert.equal(drawingShapeSchema.safeParse(invalid).success, false);
});

test("primitive locks round-trip and wire normalization preserves their lock state", () => {
	const shapes = [
		{ ...drawShape(1, "wire", { x: 0, y: 0 }, { x: 10, y: 0 }), locked: true },
		drawShape(2, "wire", { x: 10, y: 0 }, { x: 20, y: 0 }),
		{ ...drawShape(3, "circle", { x: 3, y: 3 }, { x: 5, y: 3 }), locked: true },
	];
	const normalized = normalizeWireSegments(shapes).shapes;
	assert.equal(normalized.filter((shape) => shape.kind === "wire").length, 2);
	assert.equal(
		required(normalized.find((shape) => shape.id === 1)).locked,
		true,
	);
	const file = parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "locks",
			name: "Locks",
			description: "",
			prefix: "U",
			value: "",
			shapes: [],
		}),
	);
	const restored = symbolFileShapes(
		parseSymbolFile(JSON.stringify(symbolFileWithShapes(file, shapes))),
	);
	assert.equal(restored[0].locked, true);
	assert.equal(restored[2].locked, true);
	const connected = moveShapes(
		[shapes[1]],
		{ x: 0, y: 3 },
		0,
		shapes[1],
		shapes,
	);
	assert.equal(required(connected.find((shape) => shape.id === 1)).y, 0);
});
