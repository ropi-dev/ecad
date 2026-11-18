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
