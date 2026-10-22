import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
	InvalidDrawingCommand,
	createSymbolFromSelectionEffect,
	jumpHistoryEffect,
	placeRectangleEffect,
	placeShapesEffect,
	redoEffect,
	removeShapesEffect,
	replaceShapesEffect,
	replaceAndPlaceShapesEffect,
	rotateShapesEffect,
	type ShapeInput,
	undoEffect,
} from "#/commands/drawing-commands.ts";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store.ts";
import { drawShape, editShapeAttribute, moveShapes, pinTerminals, symbolShapes, symbolTextShapes } from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";

const rectangle = {
	x: 10,
	y: 20,
	width: 30,
	height: 40,
	rotation: 0,
	lineWidth: 0.2,
};

function session() {
	const store = createDrawingStore();
	return {
		store,
		run: <A, E>(program: Effect.Effect<A, E, DrawingStore>) =>
			Effect.runSync(Effect.provideService(program, DrawingStore, store)),
	};
}

test("rotation preserves component centers, definitions and labels in one undoable transaction", () => {
	const { store, run } = session();
	const first = createSymbol(1, symbolDefinitions[0], { x: 50, y: 30 });
	first.textPositions = { reference: { x: 8, y: 4 } };
	const second = createSymbol(2, symbolDefinitions[0], { x: -40, y: 20 });
	run(placeShapesEffect([first, second, { ...rectangle, kind: "rectangle" }], "Components"));
	const before = store.getSnapshot();
	let publications = 0;
	store.subscribe(() => publications++);
	const result = run(rotateShapesEffect([2, 1]));
	const rotated = store.getSnapshot();
	assert.equal(publications, 1);
	assert.equal(rotated.history.currentId, before.history.currentId + 1);
	assert.equal(rotated.nextShapeId, before.nextShapeId);
	assert.deepEqual(new Set(result.ids), new Set([1, 2]));
	assert.equal(result.idMap.get(1), 1);
	assert.deepEqual(result.idsBySource.get(2), [2]);
	assert.deepEqual(rotated.shapes, before.shapes.map((shape) => shape.id === 3 ? shape : { ...shape, rotation: Math.PI / 2 }));
	const symbol = rotated.shapes[0];
	assert.equal(symbol.kind, "symbol");
	if (symbol.kind !== "symbol") return;
	const pin = pinTerminals(first)[0];
	const rotatedPin = pinTerminals(symbol)[0];
	assert.ok(Math.abs(rotatedPin.x - (first.x - (pin.y - first.y))) < 1e-9);
	assert.ok(Math.abs(rotatedPin.y - (first.y + (pin.x - first.x))) < 1e-9);
	const label = symbolTextShapes(symbol).find((text) => text.text === first.attributes.reference)!;
	assert.equal(label.x, first.x - 4);
	assert.equal(label.y, first.y + 8);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, rotated.shapes);
});

test("rotation captures IDs and rotates current geometry on each execution with angle wrapping", () => {
	const { store, run } = session();
	const symbol = { ...createSymbol(1, symbolDefinitions[0], { x: 0, y: 0 }), library: { scope: "project" as const, id: "parts" }, children: [] };
	run(placeShapesEffect([symbol], "Reference"));
	const ids = [1];
	const rotate = rotateShapesEffect(ids);
	ids[0] = 99;
	const moved = { ...store.getSnapshot().shapes[0], x: 100 };
	run(replaceShapesEffect([moved], "Move"));
	for (const angle of [Math.PI / 2, Math.PI, 3 * Math.PI / 2, 0]) {
		run(rotate);
		assert.deepEqual(store.getSnapshot().shapes[0], { ...moved, rotation: angle });
	}
	run(rotateShapesEffect([1], -Math.PI / 2));
	assert.equal(store.getSnapshot().shapes[0].rotation, 3 * Math.PI / 2);
	const before = store.getSnapshot();
	run(rotateShapesEffect([1], 2 * Math.PI));
	assert.strictEqual(store.getSnapshot(), before);
	run(rotateShapesEffect([]));
	assert.strictEqual(store.getSnapshot(), before);
	run(replaceShapesEffect([{ ...store.getSnapshot().shapes[0], rotation: -Math.PI }], "Negative angle"));
	const negative = store.getSnapshot();
	for (const angle of [0, 2 * Math.PI]) {
		run(rotateShapesEffect([1], angle));
		assert.strictEqual(store.getSnapshot(), negative);
	}
});

test("rotation rejects invalid inputs atomically and preserves orthogonal wires", () => {
	const { store, run } = session();
	const wire = drawShape(1, "wire", { x: 0, y: 0 }, { x: 20, y: 0 });
	const symbol = createSymbol(2, symbolDefinitions[0], { x: 60, y: 0 });
	run(placeShapesEffect([wire, symbol], "Wire and component"));
	const before = store.getSnapshot();
	for (const [ids, angle] of [
		[[1, 2], Number.NaN], [[1], Number.POSITIVE_INFINITY],
		[[2, 99], Math.PI / 2], [[2, 2], Math.PI / 2], [[0], Math.PI / 2],
		[[2, 1], Math.PI / 4],
	] as const) {
		const result = run(Effect.either(rotateShapesEffect(ids, angle)));
		assert.ok(Either.isLeft(result));
		assert.ok(result.left instanceof InvalidDrawingCommand);
		assert.strictEqual(store.getSnapshot(), before);
	}
	run(rotateShapesEffect([1], -Math.PI / 2));
	const rotated = store.getSnapshot().shapes[0];
	assert.equal(rotated.kind, "wire");
	assert.equal(rotated.x, wire.x);
	assert.equal(rotated.y, wire.y);
	assert.ok(Math.abs(Math.cos(rotated.rotation)) < 1e-9);
	assert.deepEqual(store.getSnapshot().shapes[1], before.shapes[1]);
});

test("creating a symbol preserves geometry, pins and strokes in one undoable transaction", () => {
	const { store, run } = session();
	const first = { ...drawShape(1, "rectangle", { x: 10, y: 20 }, { x: 30, y: 40 }), rotation: Math.PI / 6, lineWidth: 0.5 };
	const wire = { ...drawShape(2, "wire", { x: 40, y: 25 }, { x: 60, y: 25 }), lineWidth: 0.8 };
	const pin = { ...drawShape(3, "pin", { x: 60, y: 25 }, { x: 60, y: 25 }), name: "OUT" };
	const outside = drawShape(4, "circle", { x: 100, y: 100 }, { x: 105, y: 100 });
	run(placeShapesEffect([first, wire, pin, outside], "Draw shapes"));
	const before = store.getSnapshot();
	let publications = 0;
	store.subscribe(() => publications++);
	const result = run(createSymbolFromSelectionEffect([3, 1, 2]));
	const converted = store.getSnapshot();
	assert.equal(publications, 1);
	assert.equal(converted.history.currentId, before.history.currentId + 1);
	assert.equal(converted.nextShapeId, 6);
	assert.deepEqual(result.ids, [5]);
	for (const id of [1, 2, 3]) assert.equal(result.idMap.get(id), 5);
	assert.equal(result.idMap.get(4), 4);
	assert.equal(converted.shapes.length, 2);
	assert.deepEqual(converted.shapes[1], outside);
	const symbol = converted.shapes[0];
	assert.equal(symbol.kind, "symbol");
	if (symbol.kind !== "symbol") return;
	assert.deepEqual(symbolShapes(symbol), before.shapes.slice(0, 3));
	assert.deepEqual(pinTerminals(symbol), pinTerminals(pin));
	const thicker = editShapeAttribute(symbol, "lineWidth", 1);
	assert.equal(thicker.kind, "symbol");
	if (thicker.kind === "symbol") assert.ok(symbolShapes(thicker).every((child) => child.lineWidth === 1));
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, converted.shapes);
});

test("pin name changes commit without geometry changes and support undo and redo", () => {
	const { store, run } = session();
	const pin = drawShape(1, "pin", { x: 10, y: 20 }, { x: 10, y: 20 });
	assert.equal(pin.kind, "pin");
	if (pin.kind !== "pin") return;
	assert.equal(pin.name, "");
	run(placeShapesEffect([pin], "Place pin"));
	const named = { ...pin, name: "VCC" };
	run(replaceShapesEffect([named], "Change pin name"));
	assert.deepEqual(store.getSnapshot().shapes, [named]);
	const unchanged = store.getSnapshot();
	run(replaceShapesEffect([named], "Change pin name"));
	assert.strictEqual(store.getSnapshot(), unchanged);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [pin]);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [named]);
});

test("invalid symbol selections leave the drawing and history unchanged", () => {
	const { store, run } = session();
	run(placeShapesEffect([
		{ ...rectangle, kind: "rectangle" },
		{ ...rectangle, kind: "text", text: "Label", fontSize: 2 },
		createSymbol(3, symbolDefinitions[0], { x: 80, y: 90 }),
	], "Shapes"));
	const before = store.getSnapshot();
	for (const ids of [[], [1], [1, 1], [1, 99], [1, 2], [1, 3]]) {
		assert.ok(Either.isLeft(run(Effect.either(createSymbolFromSelectionEffect(ids)))));
		assert.strictEqual(store.getSnapshot(), before);
	}
});

test("placement is lazy and runs with complete geometry without React, DOM or a renderer", () => {
	assert.equal(typeof document, "undefined");
	const { store, run } = session();
	const input = { ...rectangle };
	const place = placeRectangleEffect(input);
	const before = store.getSnapshot();
	input.x = 999;
	assert.strictEqual(store.getSnapshot(), before);
	assert.deepEqual(run(place).ids, [1]);
	assert.deepEqual(store.getSnapshot().shapes, [{ ...rectangle, kind: "rectangle", id: 1 }]);
	assert.deepEqual(run(place).ids, [2]);
	assert.equal(store.getSnapshot().shapes[1].x, rectangle.x);
});

test("a command captures nested symbol inputs and store snapshots cannot be mutated", () => {
	const { store, run } = session();
	const symbol = createSymbol(900, symbolDefinitions[0], { x: 5, y: 8 });
	const original = structuredClone(symbol);
	const place = placeShapesEffect([symbol], "Place symbol");
	symbol.children[0].x = 1000;
	symbol.attributes.reference = "changed";
	symbol.texts[0].x = 1000;
	run(place);
	const saved = store.getSnapshot();
	assert.deepEqual(saved.shapes, [{ ...original, id: 1 }]);
	assert.equal(saved.nextShapeId, 2);
	assert.throws(() => saved.shapes.push(symbol), TypeError);
	assert.throws(() => { saved.shapes[0].x = 100; }, TypeError);
	assert.throws(() => { saved.history.nodes[1].state.shapes[0].x = 100; }, TypeError);
	assert.deepEqual(run(place).ids, [2]);
	assert.equal(store.getSnapshot().shapes[1].kind, "symbol");
});

test("symbol label edits commit independently of geometry and survive undo and redo", () => {
	const { store, run } = session();
	const symbol = createSymbol(1, symbolDefinitions[0], { x: 5, y: 8 });
	run(placeShapesEffect([symbol], "Place symbol"));
	const before = store.getSnapshot();
	const moved = {
		...symbol,
		texts: symbol.texts.map((text) => ({ ...text, x: text.x + 2 })),
	};
	run(replaceShapesEffect([moved], "Move symbol labels"));
	const after = store.getSnapshot();
	assert.deepEqual(after.shapes, [moved]);
	assert.equal(after.history.currentId, before.history.currentId + 1);
	run(replaceShapesEffect([structuredClone(moved)], "Unchanged labels"));
	assert.strictEqual(store.getSnapshot(), after);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [symbol]);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [moved]);
	run(replaceShapesEffect([{ ...moved, texts: [] }], "Hide symbol labels"));
	assert.deepEqual(store.getSnapshot().shapes, [{ ...moved, texts: [] }]);
});

test("invalid symbol labels reject placements and replacements atomically", () => {
	const { store, run } = session();
	const symbol = createSymbol(1, symbolDefinitions[0], { x: 5, y: 8 });
	run(placeShapesEffect([symbol, { ...rectangle, kind: "rectangle" }], "Place shapes"));
	const before = store.getSnapshot();
	const label = symbol.texts[0];
	const invalidTexts: unknown[] = [
		undefined,
		null,
		{},
		[null],
		["reference"],
		[{}],
		[{ ...label, attribute: "missing" }],
		[{ ...label, x: Number.NaN }],
		[{ ...label, y: Number.POSITIVE_INFINITY }],
		[{ ...label, fontSize: 0 }],
		[{ ...label, fontSize: -1 }],
		[{ ...label, fontSize: Number.NaN }],
		[{ ...label, fontSize: Number.POSITIVE_INFINITY }],
	];
	for (const texts of invalidTexts) {
		const invalidSymbol = { ...symbol, texts: texts as typeof symbol.texts };
		const commands = [
			placeShapesEffect([{ ...rectangle, kind: "rectangle" }, invalidSymbol], "Invalid placement"),
			replaceShapesEffect([{ ...before.shapes[1], x: 100 }, invalidSymbol], "Invalid replacement"),
		];
		for (const command of commands) {
			const result = run(Effect.either(command));
			assert.ok(Either.isLeft(result));
			assert.ok(result.left instanceof InvalidDrawingCommand);
			assert.strictEqual(store.getSnapshot(), before);
		}
	}
});

test("invalid complete inputs and invalid replacement IDs leave the whole transaction unchanged", () => {
	const { store, run } = session();
	run(placeRectangleEffect(rectangle));
	const before = store.getSnapshot();
	const existing = before.shapes[0];
	const invalid = [
		placeRectangleEffect({ ...rectangle, width: 0 }),
		placeRectangleEffect({ ...rectangle, x: Number.NaN }),
		placeRectangleEffect({ ...rectangle, lineWidth: -1 }),
		placeRectangleEffect({ ...rectangle, height: undefined } as unknown as typeof rectangle),
		placeShapesEffect([{ ...rectangle, kind: "circle" }], "Place circle"),
		replaceShapesEffect([{ ...existing, id: 99 }], "Missing"),
		replaceShapesEffect([existing, existing], "Duplicate"),
		replaceShapesEffect([existing], "Missing target", [99]),
		replaceShapesEffect([existing], "Duplicate targets", [1, 1]),
		replaceShapesEffect([{ ...existing, x: 30 }, { ...existing, id: 2, width: 0 }], "Invalid batch"),
		removeShapesEffect([1, 1]),
		removeShapesEffect([1, 99]),
		jumpHistoryEffect(99),
	];
	for (const command of invalid) {
		const result = run(Effect.either(command));
		assert.ok(Either.isLeft(result));
		assert.ok(result.left instanceof InvalidDrawingCommand);
		assert.strictEqual(store.getSnapshot(), before);
	}
});

test("wire placement normalizes one committed transaction and returns every surviving ID", () => {
	const { store, run } = session();
	const first = drawShape(99, "wire", { x: 0, y: 0 }, { x: 10, y: 0 });
	const second = drawShape(98, "wire", { x: 5, y: 0 }, { x: 20, y: 0 });
	run(placeShapesEffect([first], "First wire"));
	const observations: number[][] = [];
	const unsubscribe = store.subscribe(() => {
		const state = store.getSnapshot();
		observations.push(state.shapes.map((shape) => shape.id));
		assert.deepEqual(state.history.nodes[state.history.currentId].state.shapes, state.shapes);
	});
	const result = run(placeShapesEffect([second], "Extend wire"));
	assert.deepEqual(observations, [[2]]);
	assert.deepEqual(result.ids, [2]);
	assert.equal(result.idMap.get(1), 2);
	assert.equal(result.idMap.get(2), 2);
	assert.equal(store.getSnapshot().shapes[0].width, 20);
	assert.equal(store.getSnapshot().history.currentId, 2);
	unsubscribe();
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, [{ ...first, id: 1 }]);
	run(redoEffect);
	assert.equal(store.getSnapshot().shapes[0].width, 20);
	assert.equal(observations.length, 1);
});

test("a collapsed wire is removed at commit and undo restores the complete edit", () => {
	const { store, run } = session();
	const first = drawShape(1, "wire", { x: 0, y: 0 }, { x: 10, y: 0 });
	const neighbor = drawShape(2, "wire", { x: 10, y: 0 }, { x: 10, y: 10 });
	run(placeShapesEffect([first, neighbor], "Wire corner"));
	const before = store.getSnapshot();
	const result = run(replaceShapesEffect([{ ...first, width: 0 }, { ...neighbor, y: 8, width: 16 }], "Resize wires"));
	assert.deepEqual(result.ids, [2]);
	assert.equal(result.idMap.has(1), false);
	assert.equal(store.getSnapshot().shapes.length, 1);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
	assert.equal(store.getSnapshot().nextShapeId, 3);
});

test("wire merging retains the explicit target ID when a changed neighbor precedes it", () => {
	const { store, run } = session();
	const neighbor = drawShape(1, "wire", { x: 0, y: 0 }, { x: 10, y: 0 });
	const target = drawShape(2, "wire", { x: 20, y: 0 }, { x: 30, y: 0 });
	run(placeShapesEffect([neighbor, target], "Separate wires"));
	const targets = [2];
	const resize = replaceShapesEffect([
		{ ...neighbor, x: 10, width: 20 },
		target,
	], "Connect wires", targets);
	targets[0] = 1;
	const result = run(resize);
	assert.deepEqual(result.ids, [2]);
	assert.equal(result.idMap.get(1), 2);
	assert.equal(store.getSnapshot().shapes[0].id, 2);
	assert.equal(store.getSnapshot().shapes[0].width, 30);
});

test("undo branches preserve alternate drawings and never reuse allocated shape IDs", () => {
	const { store, run } = session();
	run(placeRectangleEffect(rectangle));
	run(placeRectangleEffect({ ...rectangle, x: 100 }));
	const originalBranch = store.getSnapshot().history.currentId;
	run(undoEffect);
	assert.deepEqual(run(placeRectangleEffect({ ...rectangle, x: -100 })).ids, [3]);
	const newBranch = store.getSnapshot().history.currentId;
	run(jumpHistoryEffect(originalBranch));
	assert.deepEqual(store.getSnapshot().shapes.map((shape) => shape.id), [1, 2]);
	run(jumpHistoryEffect(newBranch));
	assert.deepEqual(store.getSnapshot().shapes.map((shape) => shape.id), [1, 3]);
	assert.deepEqual(run(placeRectangleEffect(rectangle)).ids, [4]);
	assert.deepEqual(store.getSnapshot().history.nodes[1].childIds, [2, 3]);
});

test("replacement and deletion capture explicit IDs and no-op edits publish no history or snapshot", () => {
	const { store, run } = session();
	run(placeRectangleEffect(rectangle));
	const before = store.getSnapshot();
	let publications = 0;
	store.subscribe(() => publications++);
	run(replaceShapesEffect([...before.shapes], "Unchanged"));
	assert.strictEqual(store.getSnapshot(), before);
	assert.equal(publications, 0);
	const changed = { ...before.shapes[0], x: 80 };
	const replace = replaceShapesEffect([changed], "Move rectangle");
	changed.x = 90;
	run(replace);
	assert.equal(store.getSnapshot().shapes[0].x, 80);
	const ids = [1];
	const remove = removeShapesEffect(ids);
	ids[0] = 999;
	run(remove);
	assert.equal(store.getSnapshot().shapes.length, 0);
	run(undoEffect);
	assert.equal(store.getSnapshot().shapes[0].x, 80);
	assert.equal(publications, 3);
});

test("headless commands can place measured text and reject nonorthogonal wires", () => {
	const { store, run } = session();
	const text: ShapeInput = {
		...rectangle,
		kind: "text",
		text: "Given dimensions",
		fontSize: 5,
	};
	run(placeShapesEffect([text], "Place text"));
	assert.equal(store.getSnapshot().shapes[0].kind, "text");
	const diagonal = { ...drawShape(10, "wire", { x: 0, y: 0 }, { x: 10, y: 0 }), rotation: Math.PI / 4 };
	const result = run(Effect.either(placeShapesEffect([diagonal], "Invalid wire")));
	assert.ok(Either.isLeft(result));
	assert.equal(store.getSnapshot().history.currentId, 1);
});

test("concurrent Effect callers commit against current state and allocate distinct IDs", async () => {
	const store = createDrawingStore();
	const placements = Array.from({ length: 20 }, (_, x) => placeRectangleEffect({ ...rectangle, x }));
	await Effect.runPromise(Effect.all(placements, { concurrency: "unbounded" }).pipe(Effect.provideService(DrawingStore, store)));
	const snapshot = store.getSnapshot();
	assert.equal(snapshot.shapes.length, 20);
	assert.equal(new Set(snapshot.shapes.map((shape) => shape.id)).size, 20);
	assert.equal(snapshot.nextShapeId, 21);
	assert.equal(Object.keys(snapshot.history.nodes).length, 21);
});

// Compile-time examples document that a placement cannot depend on a later UI gesture.
if (false) {
	// @ts-expect-error Placement requires size, rotation and stroke, not only a position.
	placeRectangleEffect({ x: 10, y: 20 });
	// @ts-expect-error Text placement requires its already measured dimensions.
	placeShapesEffect([{ kind: "text", text: "Pending", fontSize: 5 }], "Place text");
}

test("branch placement splits a trunk in one transaction with stable IDs and atomic undo", () => {
	const { store, run } = session();
	const trunk = drawShape(1, "wire", { x: 0, y: 0 }, { x: 100, y: 0 });
	run(placeShapesEffect([trunk], "Trunk"));
	const before = store.getSnapshot();
	let publications = 0;
	store.subscribe(() => publications++);
	run(placeShapesEffect([drawShape(2, "wire", { x: 50, y: 20 }, { x: 50, y: 0 })], "Branch"));
	const tee = store.getSnapshot();
	assert.equal(publications, 1);
	assert.equal(tee.shapes.length, 3);
	assert.equal(tee.nextShapeId, 4);
	assert.equal(tee.history.currentId, before.history.currentId + 1);
	run(replaceShapesEffect(tee.shapes, "Unchanged"));
	assert.strictEqual(store.getSnapshot(), tee);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, tee.shapes);
	run(placeShapesEffect([drawShape(4, "wire", { x: 50, y: -20 }, { x: 50, y: 0 })], "Fourth leg"));
	const cross = store.getSnapshot();
	assert.equal(cross.shapes.length, 4);
	assert.equal(cross.nextShapeId, 5);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, tee.shapes);
	run(undoEffect);
	const branch = run(placeShapesEffect([drawShape(2, "wire", { x: 30, y: 20 }, { x: 30, y: 0 })], "Alternate branch"));
	assert.deepEqual(branch.ids, [5]);
	assert.deepEqual(store.getSnapshot().shapes.map(({ id }) => id), [1, 6, 5]);
	assert.ok(store.getSnapshot().nextShapeId >= 7);
});

for (const reversed of [false, true]) test(`drawing a wire through existing branches returns every new piece with reversed=${reversed}`, () => {
	const { store, run } = session();
	const branch = (x: number) => drawShape(1, "wire", { x, y: 30 }, { x, y: 0 });
	run(placeShapesEffect([branch(25), branch(75)], "Existing branches"));
	const before = store.getSnapshot();
	const result = run(placeShapesEffect([drawShape(3, "wire", { x: reversed ? 100 : 0, y: 0 }, { x: reversed ? 0 : 100, y: 0 })], "Wire through junctions"));
	const after = store.getSnapshot();
	assert.deepEqual(result.ids, [3, 4, 5]);
	assert.deepEqual(result.idsBySource.get(3), [3, 4, 5]);
	assert.deepEqual(result.idsBySource.get(1), [1]);
	assert.deepEqual(result.idsBySource.get(2), [2]);
	assert.ok(result.ids.every((id) => after.shapes.some((shape) => shape.id === id && shape.rotation % Math.PI === 0)));
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, after.shapes);
});

test("placing a branch selects its own pieces and excludes the split preexisting trunk", () => {
	const { store, run } = session();
	run(placeShapesEffect([drawShape(1, "wire", { x: 0, y: 0 }, { x: 100, y: 0 })], "Trunk"));
	const result = run(placeShapesEffect([drawShape(2, "wire", { x: 50, y: 30 }, { x: 50, y: 0 })], "Branch"));
	assert.deepEqual(result.ids, [2]);
	assert.deepEqual(result.idsBySource.get(1), [1, 3]);
	assert.deepEqual(result.idsBySource.get(2), [2]);
	const edit = run(replaceShapesEffect([{ ...store.getSnapshot().shapes[0], lineWidth: 0.5 }], "Stroke"));
	assert.deepEqual(edit.idsBySource.get(1), [1]);
});

test("placing a pin splits an existing wire without selecting its pieces and undoes atomically", () => {
	const { store, run } = session();
	run(placeShapesEffect([drawShape(1, "wire", { x: 0, y: 0 }, { x: 100, y: 0 })], "Trunk"));
	const before = store.getSnapshot();
	const result = run(placeShapesEffect([drawShape(2, "pin", { x: 50, y: 0 }, { x: 50, y: 0 })], "Pin on wire"));
	const after = store.getSnapshot();
	assert.deepEqual(result.ids, [2]);
	assert.deepEqual(result.idsBySource.get(1), [1, 3]);
	assert.equal(after.shapes.length, 3);
	assert.equal(after.nextShapeId, 4);
	assert.equal(after.history.currentId, before.history.currentId + 1);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, after.shapes);
	run(removeShapesEffect([2]));
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
});

test("drawing through an existing pin returns every piece and moving the pin away rejoins them", () => {
	const { store, run } = session();
	run(placeShapesEffect([drawShape(1, "pin", { x: 50, y: 0 }, { x: 50, y: 0 })], "Pin"));
	const result = run(placeShapesEffect([drawShape(2, "wire", { x: 0, y: 0 }, { x: 100, y: 0 })], "Wire through pin"));
	assert.deepEqual(result.ids, [2, 3]);
	assert.deepEqual(result.idsBySource.get(2), [2, 3]);
	const before = store.getSnapshot();
	run(replaceShapesEffect([{ ...before.shapes[0], y: 10 }], "Move pin away"));
	assert.equal(store.getSnapshot().shapes.filter((shape) => shape.kind === "wire").length, 1);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
});

for (const rotation of [0, Math.PI / 2]) test(`symbol pin terminals split a wire with rotation=${rotation}`, () => {
	const { store, run } = session();
	const symbol = { ...createSymbol(1, symbolDefinitions[0], { x: 50, y: 0 }), rotation };
	const [first, second] = pinTerminals(symbol);
	const vertical = rotation !== 0;
	run(placeShapesEffect([symbol], "Component"));
	const result = run(placeShapesEffect([drawShape(2, "wire", vertical ? { x: 50, y: -20 } : { x: 30, y: 0 }, vertical ? { x: 50, y: 20 } : { x: 70, y: 0 })], "Wire through component pins"));
	assert.deepEqual(result.ids, [2, 3, 4]);
	const wires = store.getSnapshot().shapes.filter((shape) => shape.kind === "wire");
	assert.equal(wires.length, 3);
	for (const pin of [first, second]) assert.equal(wires.filter((wire) => Math.abs(Math.hypot(wire.x - pin.x, wire.y - pin.y) - wire.width / 2) < 1e-6).length, 2);
});


test("moving an attached component and adding wires commits once and restores through undo and redo", () => {
	const symbol = createSymbol(1, symbolDefinitions[0], { x: 50, y: 60 });
	const [terminal] = pinTerminals(symbol);
	const wire = drawShape(2, "wire", { x: 20, y: 60 }, terminal);
	const store = createDrawingStore([symbol, wire]);
	const run = <A, E>(program: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(Effect.provideService(program, DrawingStore, store));
	const initial = store.getSnapshot();
	const moved = moveShapes(
		[symbol],
		{ x: 10, y: 20 },
		0,
		symbol,
		initial.shapes,
		initial.nextShapeId,
	);
	let publications = 0;
	store.subscribe(() => publications++);
	const result = run(
		replaceAndPlaceShapesEffect([moved[0]], moved.slice(1), "Move selection", [
			symbol.id,
		]),
	);
	const committed = store.getSnapshot();
	assert.equal(publications, 1);
	assert.equal(committed.shapes.length, 4);
	assert.equal(committed.nextShapeId, 5);
	assert.deepEqual(committed.shapes[1], wire);
	assert.deepEqual(pinTerminals(committed.shapes[0])[0], {
		x: terminal.x + 10,
		y: terminal.y + 20,
	});
	assert.deepEqual(result.idsBySource.get(symbol.id), [symbol.id]);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, initial.shapes);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, committed.shapes);
	run(undoEffect);
	const branch = moveShapes(
		[symbol],
		{ x: -10, y: -20 },
		0,
		symbol,
		initial.shapes,
		store.getSnapshot().nextShapeId,
	);
	run(
		replaceAndPlaceShapesEffect(
			[branch[0]],
			branch.slice(1),
			"Move selection",
			[symbol.id],
		),
	);
	assert.equal(
		new Set(store.getSnapshot().shapes.map(({ id }) => id)).size,
		store.getSnapshot().shapes.length,
	);
	assert.ok(store.getSnapshot().nextShapeId >= 7);
});
