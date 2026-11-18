import assert from "node:assert/strict";
import test from "node:test";
import {
	placeShapesEffect,
	replaceShapesEffect,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import { drawingSnapshotSchema } from "@ecad/drawing-core/commands/drawing-snapshot.ts";
import {
	createDrawingStore,
	DrawingStore,
	restoreDrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { electricalNets } from "@ecad/drawing-core/drawing/named-nets.ts";
import {
	drawShape,
	type EditorShape,
	type TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { Effect } from "effect";
import { validateProjectDocument } from "#/projects/format.ts";
import { required } from "./helpers/required.ts";

const wire = (id: number, x: number, y: number, endX: number, endY = y) =>
	drawShape(id, "wire", { x, y }, { x: endX, y: endY });
const label = (
	id: number,
	text: string,
	x: number,
	y: number,
	electrical: TextShape["electrical"] = "net",
): TextShape => ({
	id,
	kind: "text",
	text,
	electrical,
	x,
	y,
	width: 8,
	height: 2,
	fontSize: 1.5,
	lineWidth: 0.2,
	rotation: 0,
	horizontalAlign: "left",
	verticalAlign: "bottom",
});
const netForWire = (shapes: EditorShape[], id: number) => {
	const net = electricalNets(shapes).find((net) => net.wires.includes(id));
	assert.ok(net, `Missing net for wire ${id}`);
	return net;
};

test("matching named nets and supply names join disconnected wire sections", () => {
	const shapes = [
		wire(1, 0, 0, 10),
		wire(2, 30, 10, 40),
		label(3, "+3V3", 0, 0),
		label(4, "+3V3", 40, 10, "supply"),
	];
	const net = netForWire(shapes, 1);
	assert.deepEqual(new Set(net.wires), new Set([1, 2]));
	assert.deepEqual(new Set(net.labels), new Set([3, 4]));
	assert.deepEqual(net.names, ["+3V3"]);
});

test("different names and differently cased names remain separate", () => {
	const shapes = [
		wire(1, 0, 0, 10),
		wire(2, 30, 0, 40),
		wire(3, 60, 0, 70),
		label(4, "GND", 0, 0),
		label(5, "VCC", 30, 0),
		label(6, "gnd", 60, 0),
	];
	for (const id of [1, 2, 3])
		assert.deepEqual(netForWire(shapes, id).wires, [id]);
});

test("ordinary text matching a net name has no electrical meaning", () => {
	const ordinary = label(4, "GND", 30, 0);
	delete ordinary.electrical;
	const shapes = [
		wire(1, 0, 0, 10),
		wire(2, 30, 0, 40),
		label(3, "GND", 0, 0),
		ordinary,
	];
	assert.deepEqual(netForWire(shapes, 1).wires, [1]);
	assert.deepEqual(netForWire(shapes, 2).wires, [2]);
	assert.ok(electricalNets(shapes).every((net) => !net.labels.includes(4)));
});

test("only the label anchor attaches, including at wire interiors and rotated text", () => {
	const shapes = [
		wire(1, 0, 0, 20),
		wire(2, 40, 0, 60),
		wire(3, 80, 0, 100),
		label(4, "RUN", 10, 0),
		{ ...label(5, "RUN", 50, 0), rotation: Math.PI / 2 },
		label(6, "RUN", 90, 1),
	];
	assert.deepEqual(new Set(netForWire(shapes, 1).wires), new Set([1, 2]));
	assert.deepEqual(netForWire(shapes, 3).wires, [3]);
});

test("a label anchors to a pin terminal and aliases a remote wire", () => {
	const pin = drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
	const shapes = [
		pin,
		wire(2, 30, 0, 40),
		label(3, "IO", 0, 0),
		label(4, "IO", 30, 0),
	];
	assert.deepEqual(netForWire(shapes, 2).pins, [{ shapeId: 1, pinId: 1 }]);
});

test("bare crossings stay separate and endpoint junctions conduct", () => {
	const crossing = [
		wire(1, -10, 0, 10),
		wire(2, 0, -10, 0, 10),
		label(3, "HORIZONTAL", -10, 0),
		label(4, "VERTICAL", 0, -10),
	];
	assert.deepEqual(netForWire(crossing, 1).wires, [1]);
	assert.deepEqual(
		new Set(netForWire([wire(1, 0, 0, 20), wire(2, 10, 0, 10, 10)], 1).wires),
		new Set([1, 2]),
	);
});

test("wire bridges propagate multiple aliases transitively", () => {
	const shapes = [
		wire(1, 0, 0, 10),
		wire(2, 30, 0, 40),
		wire(3, 60, 0, 70),
		label(4, "A", 0, 0),
		label(5, "A", 30, 0),
		label(6, "B", 40, 0),
		label(7, "B", 60, 0),
	];
	const net = netForWire(shapes, 1);
	assert.deepEqual(new Set(net.wires), new Set([1, 2, 3]));
	assert.deepEqual(new Set(net.names), new Set(["A", "B"]));
});

test("named nets survive drawing save, reload, rename, and undo", () => {
	const shapes = [
		wire(1, 0, 0, 10),
		wire(2, 30, 0, 40),
		label(3, "GND", 0, 0),
		label(4, "GND", 30, 0, "supply"),
	];
	const document = validateProjectDocument(
		JSON.parse(JSON.stringify({ shapes, symbols: [] })),
	);
	assert.deepEqual(document.shapes, shapes);
	assert.deepEqual(
		new Set(netForWire(document.shapes, 1).wires),
		new Set([1, 2]),
	);
	const store = createDrawingStore();
	const run = <A, E>(effect: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(Effect.provideService(effect, DrawingStore, store));
	run(placeShapesEffect(shapes, "Named nets"));
	const snapshot = drawingSnapshotSchema.parse(
		JSON.parse(JSON.stringify(store.getSnapshot())),
	);
	const restored = restoreDrawingStore(snapshot);
	assert.deepEqual(restored.getSnapshot(), store.getSnapshot());
	run(
		replaceShapesEffect(
			[{ ...label(4, "VCC", 30, 0, "supply") }],
			"Rename supply",
		),
	);
	assert.deepEqual(netForWire(store.getSnapshot().shapes, 1).wires, [1]);
	run(undoEffect);
	assert.deepEqual(
		new Set(netForWire(store.getSnapshot().shapes, 1).wires),
		new Set([1, 2]),
	);
});

test("net symbols name terminal nets, merge aliases, and follow instance names", async () => {
	const { createSymbol, symbolDefinitions } = await import(
		"#/drawing/symbols.ts"
	);
	const { symbolShapes } = await import("@ecad/drawing-core/drawing/shapes.ts");
	for (const id of [
		"ground",
		"signal-ground",
		"vcc",
		"vdd",
		"power-3v3",
		"power-5v",
	]) {
		const definition = required(
			symbolDefinitions.find((symbol) => symbol.id === id),
		);
		const symbol = createSymbol(1, definition, { x: 10, y: 20 });
		assert.equal(symbol.netSymbol, true);
		symbol.rotation = Math.PI / 2;
		const pin = required(
			symbolShapes(symbol).find((child) => child.kind === "pin"),
		);
		const shapes = [
			symbol,
			wire(2, pin.x, pin.y, pin.x + 10),
			wire(3, 100, 100, 110),
			label(4, symbol.attributes.name, 100, 100),
		];
		assert.deepEqual(netForWire(shapes, 2).wires, [2, 3]);
		assert.deepEqual(netForWire(shapes, 2).names, [symbol.attributes.name]);
		const renamed = {
			...symbol,
			attributes: { ...symbol.attributes, name: "ANALOG" },
		};
		assert.deepEqual(netForWire([renamed, ...shapes.slice(1)], 2).wires, [2]);
		assert.deepEqual(netForWire([renamed, ...shapes.slice(1)], 2).names, [
			"ANALOG",
		]);
		const fallback = {
			...symbol,
			attributes: { ...symbol.attributes, name: " " },
		};
		assert.deepEqual(netForWire([fallback, ...shapes.slice(1)], 2).names, []);
	}
	for (const id of ["battery", "battery-cell", "resistor"]) {
		const definition = required(
			symbolDefinitions.find((symbol) => symbol.id === id),
		);
		assert.equal(
			createSymbol(1, definition, { x: 0, y: 0 }).netSymbol,
			undefined,
		);
	}
});

test("net symbol role and names survive save, reload, edits, and undo", async () => {
	const { createSymbol, symbolDefinitions } = await import(
		"#/drawing/symbols.ts"
	);
	const symbol = createSymbol(
		1,
		required(symbolDefinitions.find((symbol) => symbol.id === "vdd")),
		{ x: 0, y: 0 },
	);
	const store = createDrawingStore();
	const run = <A, E>(effect: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(Effect.provideService(effect, DrawingStore, store));
	run(placeShapesEffect([symbol, wire(2, 0, 0, 10)], "Place supply"));
	const reopened = validateProjectDocument(
		JSON.parse(
			JSON.stringify({ shapes: store.getSnapshot().shapes, symbols: [] }),
		),
	);
	assert.deepEqual(netForWire(reopened.shapes, 2).names, ["VDD"]);
	run(
		replaceShapesEffect(
			[{ ...symbol, netSymbol: false }],
			"Disable net symbol",
		),
	);
	assert.deepEqual(netForWire(store.getSnapshot().shapes, 2).names, []);
	run(undoEffect);
	assert.deepEqual(netForWire(store.getSnapshot().shapes, 2).names, ["VDD"]);
	run(
		replaceShapesEffect(
			[{ ...symbol, attributes: { ...symbol.attributes, name: "VCC" } }],
			"Rename supply",
		),
	);
	assert.deepEqual(netForWire(store.getSnapshot().shapes, 2).names, ["VCC"]);
	run(undoEffect);
	assert.deepEqual(netForWire(store.getSnapshot().shapes, 2).names, ["VDD"]);
});
