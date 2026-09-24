import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
	InvalidDrawingCommand,
	jumpHistoryEffect,
	placeRectangleEffect,
	placeShapesEffect,
	redoEffect,
	removeShapesEffect,
	replaceShapesEffect,
	type ShapeInput,
	undoEffect,
} from "../src/commands/drawing-commands.ts";
import { createDrawingStore, DrawingStore } from "../src/commands/drawing-store.ts";
import { drawShape } from "../src/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "../src/drawing/symbols.ts";

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
