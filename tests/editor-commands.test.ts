import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createSymbolFromSelectionEffect,
	InvalidDrawingCommand,
	jumpHistoryEffect,
	placeRectangleEffect,
	placeShapesEffect,
	redoEffect,
	removeShapesEffect,
	replaceAndPlaceShapesEffect,
	replaceShapesEffect,
	rotateShapesEffect,
	type ShapeInput,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	drawShape,
	editShapeAttribute,
	moveShapes,
	pinTerminals,
	symbolShapes,
	symbolTextShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { Effect, Either } from "effect";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "./helpers/required.ts";

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
	run(
		placeShapesEffect(
			[first, second, { ...rectangle, kind: "rectangle" }],
			"Components",
		),
	);
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
	assert.deepEqual(
		rotated.shapes,
		before.shapes.map((shape) =>
			shape.id === 3 ? shape : { ...shape, rotation: Math.PI / 2 },
		),
	);
	const symbol = rotated.shapes[0];
	assert.equal(symbol.kind, "symbol");
	if (symbol.kind !== "symbol") return;
	const pin = pinTerminals(first)[0];
	const rotatedPin = pinTerminals(symbol)[0];
	assert.ok(Math.abs(rotatedPin.x - (first.x - (pin.y - first.y))) < 1e-9);
	assert.ok(Math.abs(rotatedPin.y - (first.y + (pin.x - first.x))) < 1e-9);
	const label = required(
		symbolTextShapes(symbol).find(
			(text) => text.text === first.attributes.reference,
		),
	);
	assert.equal(label.x, first.x - 4);
	assert.equal(label.y, first.y + 8);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, rotated.shapes);
});

test("rotation captures IDs and rotates current geometry on each execution with angle wrapping", () => {
	const { store, run } = session();
	const symbol = {
		...createSymbol(1, symbolDefinitions[0], { x: 0, y: 0 }),
		library: { scope: "project" as const, id: "parts" },
		children: [],
	};
	run(placeShapesEffect([symbol], "Reference"));
	const ids = [1];
	const rotate = rotateShapesEffect(ids);
	ids[0] = 99;
	const moved = { ...store.getSnapshot().shapes[0], x: 100 };
	run(replaceShapesEffect([moved], "Move"));
	for (const angle of [Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 0]) {
		run(rotate);
		assert.deepEqual(store.getSnapshot().shapes[0], {
			...moved,
			rotation: angle,
		});
	}
	run(rotateShapesEffect([1], -Math.PI / 2));
	assert.equal(store.getSnapshot().shapes[0].rotation, (3 * Math.PI) / 2);
	const before = store.getSnapshot();
	run(rotateShapesEffect([1], 2 * Math.PI));
	assert.strictEqual(store.getSnapshot(), before);
	run(rotateShapesEffect([]));
	assert.strictEqual(store.getSnapshot(), before);
	run(
		replaceShapesEffect(
			[{ ...store.getSnapshot().shapes[0], rotation: -Math.PI }],
			"Negative angle",
		),
	);
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
		[[1, 2], Number.NaN],
		[[1], Number.POSITIVE_INFINITY],
		[[2, 99], Math.PI / 2],
		[[2, 2], Math.PI / 2],
		[[0], Math.PI / 2],
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
	const first = {
		...drawShape(1, "rectangle", { x: 10, y: 20 }, { x: 30, y: 40 }),
		rotation: Math.PI / 6,
		lineWidth: 0.5,
	};
	const wire = {
		...drawShape(2, "wire", { x: 40, y: 25 }, { x: 60, y: 25 }),
		lineWidth: 0.8,
	};
	const pin = {
		...drawShape(3, "pin", { x: 60, y: 25 }, { x: 60, y: 25 }),
		name: "OUT",
	};
	const outside = drawShape(
		4,
		"circle",
		{ x: 100, y: 100 },
		{ x: 105, y: 100 },
	);
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
	if (thicker.kind === "symbol")
		assert.ok(symbolShapes(thicker).every((child) => child.lineWidth === 1));
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
	run(redoEffect);
	assert.deepEqual(store.getSnapshot().shapes, converted.shapes);
});

for (const attribute of ["name", "number"] as const)
	test(`pin ${attribute} changes commit without geometry changes and support undo and redo`, () => {
		const { store, run } = session();
		const pin = drawShape(1, "pin", { x: 10, y: 20 }, { x: 10, y: 20 });
		assert.equal(pin.kind, "pin");
		if (pin.kind !== "pin") return;
		assert.equal(pin[attribute], "");
		run(placeShapesEffect([pin], "Place pin"));
		const named = { ...pin, [attribute]: attribute === "name" ? "VCC" : "01" };
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
	run(
		placeShapesEffect(
			[
				{ ...rectangle, kind: "rectangle" },
				{ ...rectangle, kind: "text", text: "Label", fontSize: 2 },
				createSymbol(3, symbolDefinitions[0], { x: 80, y: 90 }),
			],
			"Shapes",
		),
	);
	const before = store.getSnapshot();
	for (const ids of [[], [1], [1, 1], [1, 99], [1, 3]]) {
		assert.ok(
			Either.isLeft(run(Effect.either(createSymbolFromSelectionEffect(ids)))),
		);
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
	assert.deepEqual(store.getSnapshot().shapes, [
		{ ...rectangle, kind: "rectangle", id: 1 },
	]);
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
	assert.throws(() => {
		saved.shapes[0].x = 100;
	}, TypeError);
	assert.throws(() => {
		saved.history.nodes[1].state.shapes[0].x = 100;
	}, TypeError);
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
	run(
		placeShapesEffect(
			[symbol, { ...rectangle, kind: "rectangle" }],
			"Place shapes",
		),
	);
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
			placeShapesEffect(
				[{ ...rectangle, kind: "rectangle" }, invalidSymbol],
				"Invalid placement",
			),
			replaceShapesEffect(
				[{ ...before.shapes[1], x: 100 }, invalidSymbol],
				"Invalid replacement",
			),
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
		placeRectangleEffect({
			...rectangle,
			height: undefined,
		} as unknown as typeof rectangle),
		placeShapesEffect([{ ...rectangle, kind: "circle" }], "Place circle"),
		replaceShapesEffect([{ ...existing, id: 99 }], "Missing"),
		replaceShapesEffect([existing, existing], "Duplicate"),
		replaceShapesEffect([existing], "Missing target", [99]),
		replaceShapesEffect([existing], "Duplicate targets", [1, 1]),
		replaceShapesEffect(
			[
				{ ...existing, x: 30 },
				{ ...existing, id: 2, width: 0 },
			],
			"Invalid batch",
		),
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
		assert.deepEqual(
			state.history.nodes[state.history.currentId].state.shapes,
			state.shapes,
		);
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
	const result = run(
		replaceShapesEffect(
			[
				{ ...first, width: 0 },
				{ ...neighbor, y: 8, width: 16 },
			],
			"Resize wires",
		),
	);
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
	const resize = replaceShapesEffect(
		[{ ...neighbor, x: 10, width: 20 }, target],
		"Connect wires",
		targets,
	);
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
	assert.deepEqual(
		run(placeRectangleEffect({ ...rectangle, x: -100 })).ids,
		[3],
	);
	const newBranch = store.getSnapshot().history.currentId;
	run(jumpHistoryEffect(originalBranch));
	assert.deepEqual(
		store.getSnapshot().shapes.map((shape) => shape.id),
		[1, 2],
	);
	run(jumpHistoryEffect(newBranch));
	assert.deepEqual(
		store.getSnapshot().shapes.map((shape) => shape.id),
		[1, 3],
	);
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
	const diagonal = {
		...drawShape(10, "wire", { x: 0, y: 0 }, { x: 10, y: 0 }),
		rotation: Math.PI / 4,
	};
	const result = run(
		Effect.either(placeShapesEffect([diagonal], "Invalid wire")),
	);
	assert.ok(Either.isLeft(result));
	assert.equal(store.getSnapshot().history.currentId, 1);
});

test("concurrent Effect callers commit against current state and allocate distinct IDs", async () => {
	const store = createDrawingStore();
	const placements = Array.from({ length: 20 }, (_, x) =>
		placeRectangleEffect({ ...rectangle, x }),
	);
	await Effect.runPromise(
		Effect.all(placements, { concurrency: "unbounded" }).pipe(
			Effect.provideService(DrawingStore, store),
		),
	);
	const snapshot = store.getSnapshot();
	assert.equal(snapshot.shapes.length, 20);
	assert.equal(new Set(snapshot.shapes.map((shape) => shape.id)).size, 20);
	assert.equal(snapshot.nextShapeId, 21);
	assert.equal(Object.keys(snapshot.history.nodes).length, 21);
});

// Compile-time examples document that a placement cannot depend on a later UI gesture.
function placementTypeExamples() {
	// @ts-expect-error Placement requires size, rotation and stroke, not only a position.
	placeRectangleEffect({ x: 10, y: 20 });
	placeShapesEffect(
		// @ts-expect-error Text placement requires its already measured dimensions.
		[{ kind: "text", text: "Pending", fontSize: 5 }],
		"Place text",
	);
}
void placementTypeExamples;

test("branch placement splits a trunk in one transaction with stable IDs and atomic undo", () => {
	const { store, run } = session();
	const trunk = drawShape(1, "wire", { x: 0, y: 0 }, { x: 100, y: 0 });
	run(placeShapesEffect([trunk], "Trunk"));
	const before = store.getSnapshot();
	let publications = 0;
	store.subscribe(() => publications++);
	run(
		placeShapesEffect(
			[drawShape(2, "wire", { x: 50, y: 20 }, { x: 50, y: 0 })],
			"Branch",
		),
	);
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
	run(
		placeShapesEffect(
			[drawShape(4, "wire", { x: 50, y: -20 }, { x: 50, y: 0 })],
			"Fourth leg",
		),
	);
	const cross = store.getSnapshot();
	assert.equal(cross.shapes.length, 4);
	assert.equal(cross.nextShapeId, 5);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, tee.shapes);
	run(undoEffect);
	const branch = run(
		placeShapesEffect(
			[drawShape(2, "wire", { x: 30, y: 20 }, { x: 30, y: 0 })],
			"Alternate branch",
		),
	);
	assert.deepEqual(branch.ids, [5]);
	assert.deepEqual(
		store.getSnapshot().shapes.map(({ id }) => id),
		[1, 6, 5],
	);
	assert.ok(store.getSnapshot().nextShapeId >= 7);
});

for (const reversed of [false, true])
	test(`drawing a wire through existing branches returns every new piece with reversed=${reversed}`, () => {
		const { store, run } = session();
		const branch = (x: number) =>
			drawShape(1, "wire", { x, y: 30 }, { x, y: 0 });
		run(placeShapesEffect([branch(25), branch(75)], "Existing branches"));
		const before = store.getSnapshot();
		const result = run(
			placeShapesEffect(
				[
					drawShape(
						3,
						"wire",
						{ x: reversed ? 100 : 0, y: 0 },
						{ x: reversed ? 0 : 100, y: 0 },
					),
				],
				"Wire through junctions",
			),
		);
		const after = store.getSnapshot();
		assert.deepEqual(result.ids, [3, 4, 5]);
		assert.deepEqual(result.idsBySource.get(3), [3, 4, 5]);
		assert.deepEqual(result.idsBySource.get(1), [1]);
		assert.deepEqual(result.idsBySource.get(2), [2]);
		assert.ok(
			result.ids.every((id) =>
				after.shapes.some(
					(shape) => shape.id === id && shape.rotation % Math.PI === 0,
				),
			),
		);
		run(undoEffect);
		assert.deepEqual(store.getSnapshot().shapes, before.shapes);
		run(redoEffect);
		assert.deepEqual(store.getSnapshot().shapes, after.shapes);
	});

test("placing a branch selects its own pieces and excludes the split preexisting trunk", () => {
	const { store, run } = session();
	run(
		placeShapesEffect(
			[drawShape(1, "wire", { x: 0, y: 0 }, { x: 100, y: 0 })],
			"Trunk",
		),
	);
	const result = run(
		placeShapesEffect(
			[drawShape(2, "wire", { x: 50, y: 30 }, { x: 50, y: 0 })],
			"Branch",
		),
	);
	assert.deepEqual(result.ids, [2]);
	assert.deepEqual(result.idsBySource.get(1), [1, 3]);
	assert.deepEqual(result.idsBySource.get(2), [2]);
	const edit = run(
		replaceShapesEffect(
			[{ ...store.getSnapshot().shapes[0], lineWidth: 0.5 }],
			"Stroke",
		),
	);
	assert.deepEqual(edit.idsBySource.get(1), [1]);
});

test("placing a pin splits an existing wire without selecting its pieces and undoes atomically", () => {
	const { store, run } = session();
	run(
		placeShapesEffect(
			[drawShape(1, "wire", { x: 0, y: 0 }, { x: 100, y: 0 })],
			"Trunk",
		),
	);
	const before = store.getSnapshot();
	const result = run(
		placeShapesEffect(
			[drawShape(2, "pin", { x: 50, y: 0 }, { x: 50, y: 0 })],
			"Pin on wire",
		),
	);
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
	run(
		placeShapesEffect(
			[drawShape(1, "pin", { x: 50, y: 0 }, { x: 50, y: 0 })],
			"Pin",
		),
	);
	const result = run(
		placeShapesEffect(
			[drawShape(2, "wire", { x: 0, y: 0 }, { x: 100, y: 0 })],
			"Wire through pin",
		),
	);
	assert.deepEqual(result.ids, [2, 3]);
	assert.deepEqual(result.idsBySource.get(2), [2, 3]);
	const before = store.getSnapshot();
	run(replaceShapesEffect([{ ...before.shapes[0], y: 10 }], "Move pin away"));
	assert.equal(
		store.getSnapshot().shapes.filter((shape) => shape.kind === "wire").length,
		1,
	);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
});

for (const rotation of [0, Math.PI / 2])
	test(`symbol pin terminals split a wire with rotation=${rotation}`, () => {
		const { store, run } = session();
		const symbol = {
			...createSymbol(1, symbolDefinitions[0], { x: 50, y: 0 }),
			rotation,
		};
		const [first, second] = pinTerminals(symbol);
		const vertical = rotation !== 0;
		run(placeShapesEffect([symbol], "Component"));
		const result = run(
			placeShapesEffect(
				[
					drawShape(
						2,
						"wire",
						vertical ? { x: 50, y: -20 } : { x: 30, y: 0 },
						vertical ? { x: 50, y: 20 } : { x: 70, y: 0 },
					),
				],
				"Wire through component pins",
			),
		);
		assert.deepEqual(result.ids, [2, 3, 4]);
		const wires = store
			.getSnapshot()
			.shapes.filter((shape) => shape.kind === "wire");
		assert.equal(wires.length, 3);
		for (const pin of [first, second])
			assert.equal(
				wires.filter(
					(wire) =>
						Math.abs(
							Math.hypot(wire.x - pin.x, wire.y - pin.y) - wire.width / 2,
						) < 1e-6,
				).length,
				2,
			);
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
	const existing = new Set(initial.shapes.map(({ id }) => id));
	const result = run(
		replaceAndPlaceShapesEffect(
			moved.filter(({ id }) => existing.has(id)),
			moved.filter(({ id }) => !existing.has(id)),
			"Move selection",
			[symbol.id],
		),
	);
	const committed = store.getSnapshot();
	assert.equal(publications, 1);
	assert.deepEqual(pinTerminals(committed.shapes[0])[0], {
		x: terminal.x + 10,
		y: terminal.y + 20,
	});
	// The open wire end stays at x = 20 and the wire follows the pin.
	assert.deepEqual(
		committed.shapes.slice(1).map((shape) => [shape.id, shape.x, shape.y]),
		[[wire.id, (20 + terminal.x + 10) / 2, terminal.y + 20]],
	);
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
			branch.filter(({ id }) => existing.has(id)),
			branch.filter(({ id }) => !existing.has(id)),
			"Move selection",
			[symbol.id],
		),
	);
	assert.equal(
		new Set(store.getSnapshot().shapes.map(({ id }) => id)).size,
		store.getSnapshot().shapes.length,
	);
});

test("rotating both ends of a shared wire reconnects the new pin positions", async () => {
	const { electricalNets } = await import(
		"@ecad/drawing-core/drawing/named-nets.ts"
	);
	const { store, run } = session();
	const first = createSymbol(1, symbolDefinitions[0], { x: 0, y: 0 });
	const second = createSymbol(2, symbolDefinitions[0], { x: 30, y: 0 });
	const a = pinTerminals(first)[1],
		b = pinTerminals(second)[0];
	run(
		placeShapesEffect(
			[first, second, drawShape(3, "wire", a, b)],
			"Connected components",
		),
	);
	const before = store.getSnapshot();
	run(rotateShapesEffect([1, 2]));
	const nets = electricalNets(store.getSnapshot().shapes);
	assert.equal(nets.filter((net) => net.pins.length === 2).length, 1);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
});

test("rotation preserves wire interior junctions for pins, labels and branches", async () => {
	const { electricalNets } = await import(
		"@ecad/drawing-core/drawing/named-nets.ts"
	);
	for (const kind of ["pin", "label", "branch"] as const) {
		const { store, run } = session();
		const symbol = createSymbol(1, symbolDefinitions[0], { x: 0, y: 0 });
		const wire = drawShape(2, "wire", pinTerminals(symbol)[0], {
			x: -40,
			y: 0,
		});
		const junction =
			kind === "pin"
				? drawShape(3, "pin", { x: -25, y: 0 }, { x: -25, y: 0 })
				: kind === "branch"
					? drawShape(3, "wire", { x: -25, y: 0 }, { x: -25, y: 20 })
					: {
							id: 3,
							kind: "text" as const,
							electrical: "net" as const,
							text: "TAP",
							x: -25,
							y: 0,
							width: 5,
							height: 2,
							fontSize: 1.3,
							rotation: 0,
							lineWidth: 0.2,
						};
		run(placeShapesEffect([symbol, wire, junction], "Interior junction"));
		const before = store.getSnapshot();
		run(rotateShapesEffect([1]));
		const net = electricalNets(store.getSnapshot().shapes).find((net) =>
			net.pins.some((pin) => pin.shapeId === 1),
		);
		assert.ok(net);
		if (kind === "label") assert.deepEqual(net.names, ["TAP"]);
		else if (kind === "pin")
			assert.ok(net.pins.some((pin) => pin.shapeId === 3));
		else assert.ok(net.wires.includes(3));
		run(undoEffect);
		assert.deepEqual(store.getSnapshot().shapes, before.shapes);
	}
});

test("rotating a component extends its connection without rewriting a locked wire", async () => {
	const { electricalNets } = await import(
		"@ecad/drawing-core/drawing/named-nets.ts"
	);
	for (const angle of [Math.PI / 2, -Math.PI / 2]) {
		const { store, run } = session();
		const symbol = createSymbol(1, symbolDefinitions[0], { x: 0, y: 0 });
		const wire = {
			...drawShape(2, "wire", pinTerminals(symbol)[0], { x: -40, y: 0 }),
			locked: true,
		};
		run(placeShapesEffect([symbol, wire], "Locked connection"));
		const before = store.getSnapshot();
		run(rotateShapesEffect([1], angle));
		const shapes = store.getSnapshot().shapes;
		assert.deepEqual(
			shapes.find((shape) => shape.id === wire.id),
			before.shapes.find((shape) => shape.id === wire.id),
		);
		assert.ok(shapes.length > before.shapes.length);
		assert.ok(
			electricalNets(shapes).some(
				(net) =>
					net.wires.includes(wire.id) &&
					net.pins.some((pin) => pin.shapeId === symbol.id),
			),
		);
		run(undoEffect);
		assert.deepEqual(store.getSnapshot().shapes, before.shapes);
	}
});

test("rotation keeps the two wired terminals of a component on distinct nets", async () => {
	const { electricalNets } = await import(
		"@ecad/drawing-core/drawing/named-nets.ts"
	);
	for (const rotation of [0, Math.PI / 2])
		for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
			const { store, run } = session();
			const symbol = {
				...createSymbol(1, symbolDefinitions[0], { x: 50, y: 60 }),
				rotation,
			};
			const pins = pinTerminals(symbol);
			const anchors = pins.map((pin) => ({
				x: symbol.x + (pin.x - symbol.x) * 4,
				y: symbol.y + (pin.y - symbol.y) * 4,
			}));
			const labels = anchors.map((point, index) => ({
				...point,
				id: 4 + index,
				kind: "text" as const,
				electrical: "net" as const,
				text: index === 0 ? "LEFT" : "RIGHT",
				width: 5,
				height: 2,
				fontSize: 1.3,
				rotation: 0,
				lineWidth: 0.2,
			}));
			run(
				placeShapesEffect(
					[
						symbol,
						drawShape(2, "wire", pins[0], anchors[0]),
						drawShape(3, "wire", pins[1], anchors[1]),
						...labels,
					],
					"Separate nets",
				),
			);
			const before = store.getSnapshot();
			const memberships = (shapes: typeof before.shapes) =>
				electricalNets(shapes)
					.map((net) => ({ names: net.names, pins: net.pins }))
					.sort((a, b) => a.names.join().localeCompare(b.names.join()));
			run(rotateShapesEffect([1], angle));
			assert.equal(
				store.getSnapshot().shapes.find((shape) => shape.id === symbol.id)
					?.rotation,
				(((rotation + angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
			);
			assert.deepEqual(
				memberships(store.getSnapshot().shapes),
				memberships(before.shapes),
			);
			run(undoEffect);
			assert.deepEqual(store.getSnapshot().shapes, before.shapes);
		}
});

test("rotation reconnects both ends of a wire with an interior label or branch", async () => {
	const { electricalNets } = await import(
		"@ecad/drawing-core/drawing/named-nets.ts"
	);
	for (const selectLabel of [false, true])
		for (const branch of [false, true]) {
			const { store, run } = session();
			const first = createSymbol(1, symbolDefinitions[0], { x: 0, y: 0 });
			const second = createSymbol(2, symbolDefinitions[0], { x: 40, y: 0 });
			const label = {
				id: 4,
				kind: "text" as const,
				electrical: "net" as const,
				text: "TAP",
				x: 20,
				y: 0,
				width: 5,
				height: 2,
				fontSize: 1.3,
				rotation: 0,
				lineWidth: 0.2,
			};
			run(
				placeShapesEffect(
					[
						first,
						second,
						drawShape(
							3,
							"wire",
							pinTerminals(first)[1],
							pinTerminals(second)[0],
						),
						label,
						...(branch
							? [drawShape(5, "wire", { x: 20, y: 0 }, { x: 20, y: 20 })]
							: []),
					],
					"Shared labeled wire",
				),
			);
			const before = store.getSnapshot();
			run(rotateShapesEffect([1, 2, ...(selectLabel ? [4] : [])]));
			const rotated = store.getSnapshot().shapes;
			for (const id of [1, 2])
				assert.equal(
					rotated.find((shape) => shape.id === id)?.rotation,
					Math.PI / 2,
				);
			const net = electricalNets(rotated).find((net) =>
				net.names.includes("TAP"),
			);
			assert.deepEqual(net?.pins.map((pin) => pin.shapeId).sort(), [1, 2]);
			run(undoEffect);
			assert.deepEqual(store.getSnapshot().shapes, before.shapes);
			run(redoEffect);
			assert.deepEqual(store.getSnapshot().shapes, rotated);
		}
});

test("moving an electrical label preserves unrelated nets along both direct routes", async () => {
	const { electricalNets } = await import(
		"@ecad/drawing-core/drawing/named-nets.ts"
	);
	for (const electrical of ["net", "supply"] as const) {
		const { store, run } = session();
		const point = { x: -10, y: 0 };
		const pin = drawShape(1, "pin", point, point);
		const label = {
			...point,
			id: 2,
			kind: "text" as const,
			electrical,
			text: "BUS",
			width: 5,
			height: 2,
			fontSize: 1.3,
			rotation: 0,
			lineWidth: 0.2,
		};
		run(
			placeShapesEffect(
				[
					pin,
					label,
					drawShape(3, "pin", { x: 10, y: 0 }, { x: 10, y: 0 }),
					drawShape(4, "pin", { x: 10, y: 10 }, { x: 10, y: 10 }),
				],
				"Label and unrelated pins",
			),
		);
		const before = store.getSnapshot();
		const selected = required(
			before.shapes.find((shape) => shape.id === label.id),
		);
		const replacements = moveShapes(
			[selected],
			{ x: 30, y: 10 },
			0,
			selected,
			before.shapes,
			before.nextShapeId,
		);
		run(
			replaceAndPlaceShapesEffect(
				[replacements[0]],
				replacements.slice(1),
				"Move label",
				[label.id],
			),
		);
		const shapes = store.getSnapshot().shapes;
		assert.equal(shapes.find((shape) => shape.id === label.id)?.x, 20);
		assert.equal(shapes.find((shape) => shape.id === label.id)?.y, 10);
		const membership = (shapes: typeof before.shapes) =>
			electricalNets(shapes)
				.map((net) => ({ names: net.names, pins: net.pins }))
				.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
		assert.deepEqual(membership(shapes), membership(before.shapes));
		run(undoEffect);
		assert.deepEqual(store.getSnapshot().shapes, before.shapes);
	}
});

test("electrical labels can leave four-way junctions without joining unrelated pins", async () => {
	const { electricalNets } = await import(
		"@ecad/drawing-core/drawing/named-nets.ts"
	);
	for (const electrical of ["net", "supply"] as const)
		for (const delta of [
			{ x: 10, y: 10 },
			{ x: 30, y: 0 },
		]) {
			const { store, run } = session();
			const point = { x: 0, y: 0 };
			const label = {
				...point,
				id: 1,
				kind: "text" as const,
				electrical,
				text: "BUS",
				width: 5,
				height: 2,
				fontSize: 1.3,
				rotation: 0,
				lineWidth: 0.2,
			};
			const arms = [
				{ x: 20, y: 0 },
				{ x: -20, y: 0 },
				{ x: 0, y: 20 },
				{ x: 0, y: -20 },
			].map((end, index) => drawShape(index + 2, "wire", point, end));
			run(
				placeShapesEffect(
					[
						label,
						...arms,
						drawShape(6, "pin", { x: 25, y: 0 }, { x: 25, y: 0 }),
					],
					"Four-way junction",
				),
			);
			const before = store.getSnapshot();
			const replacements = moveShapes(
				[before.shapes[0]],
				delta,
				0,
				before.shapes[0],
				before.shapes,
				before.nextShapeId,
			);
			run(
				replaceAndPlaceShapesEffect(
					[replacements[0]],
					replacements.slice(1),
					"Move junction label",
					[1],
				),
			);
			const shapes = store.getSnapshot().shapes;
			assert.deepEqual({ x: shapes[0].x, y: shapes[0].y }, delta);
			const net = electricalNets(shapes).find((net) =>
				net.names.includes("BUS"),
			);
			assert.ok(net && net.wires.length >= 4);
			assert.equal(net.pins.length, 0);
			run(undoEffect);
			assert.deepEqual(store.getSnapshot().shapes, before.shapes);
		}
});

test("moving a component preserves its generated label net without capturing unrelated pins", async () => {
	const { electricalNets } = await import(
		"@ecad/drawing-core/drawing/named-nets.ts"
	);
	const { store, run } = session();
	const symbol = createSymbol(1, symbolDefinitions[0], { x: 0, y: 0 });
	const point = pinTerminals(symbol)[0];
	const label = {
		...point,
		id: 2,
		kind: "text" as const,
		electrical: "net" as const,
		circuitNet: { id: "bus", label: "BUS", pinId: "left" },
		text: "BUS",
		width: 5,
		height: 2,
		fontSize: 1.3,
		rotation: 0,
		lineWidth: 0.2,
	};
	run(
		placeShapesEffect(
			[
				symbol,
				label,
				drawShape(3, "pin", { x: 10, y: 0 }, { x: 10, y: 0 }),
				drawShape(4, "pin", { x: 10, y: 10 }, { x: 10, y: 10 }),
			],
			"Generated label and unrelated pins",
		),
	);
	const before = store.getSnapshot();
	const replacements = moveShapes(
		[before.shapes[0]],
		{ x: 30, y: 10 },
		0,
		before.shapes[0],
		before.shapes,
		before.nextShapeId,
	);
	run(
		replaceAndPlaceShapesEffect(
			[replacements[0]],
			replacements.slice(1),
			"Move labeled component",
			[1],
		),
	);
	const shapes = store.getSnapshot().shapes;
	assert.deepEqual({ x: shapes[0].x, y: shapes[0].y }, { x: 30, y: 10 });
	const membership = (shapes: typeof before.shapes) =>
		electricalNets(shapes)
			.map((net) => ({ names: net.names, pins: net.pins }))
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	assert.deepEqual(membership(shapes), membership(before.shapes));
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, before.shapes);
});

test("committing a move removes the wires its reroute collapsed and keeps the nets", async () => {
	const { electricalNets } = await import(
		"@ecad/drawing-core/drawing/named-nets.ts"
	);
	const { store, run } = session();
	const first = createSymbol(1, symbolDefinitions[0], { x: 0, y: 0 });
	const second = createSymbol(2, symbolDefinitions[0], { x: 25.4, y: -10.16 });
	const [, start] = pinTerminals(first);
	const [end] = pinTerminals(second);
	run(
		placeShapesEffect(
			[
				first,
				second,
				drawShape(3, "wire", start, { x: 15.24, y: start.y }),
				drawShape(4, "wire", { x: 15.24, y: start.y }, { x: 15.24, y: end.y }),
				drawShape(5, "wire", { x: 15.24, y: end.y }, end),
			],
			"L wire",
		),
	);
	const before = store.getSnapshot();
	const nets = (shapes: typeof before.shapes) =>
		electricalNets(shapes)
			.map((net) => net.pins.length)
			.sort();
	const moving = required(before.shapes.find(({ id }) => id === second.id));
	const moved = moveShapes(
		[moving],
		{ x: 0, y: 10.16 },
		1.27,
		moving,
		before.shapes,
		before.nextShapeId,
	);
	// The reroute is a straight wire, so at least one old piece collapses.
	assert.ok(
		moved.some((shape) => shape.kind === "wire" && shape.width <= 1e-4),
	);
	const existing = new Set(before.shapes.map(({ id }) => id));
	run(
		replaceAndPlaceShapesEffect(
			moved.filter(({ id }) => existing.has(id)),
			moved.filter(({ id }) => !existing.has(id)),
			"Move selection",
			[second.id],
		),
	);
	const wires = store
		.getSnapshot()
		.shapes.filter((shape) => shape.kind === "wire");
	assert.equal(wires.length, 1);
	assert.ok(wires.every((shape) => shape.width > 1e-4));
	assert.deepEqual(nets(store.getSnapshot().shapes), nets(before.shapes));
});
