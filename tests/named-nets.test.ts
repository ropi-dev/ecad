import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { placeShapesEffect, replaceShapesEffect, undoEffect } from "#/commands/drawing-commands.ts";
import { createDrawingStore, DrawingStore, restoreDrawingStore } from "#/commands/drawing-store.ts";
import { drawingSnapshotSchema } from "@ecad/drawing-core/commands/drawing-snapshot.ts";
import { electricalNets } from "#/drawing/named-nets.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import { drawShape, type EditorShape, type TextShape } from "#/drawing/shapes.ts";
import { validateProjectDocument } from "#/projects/format.ts";

const wire = (id: number, x: number, y: number, endX: number, endY = y) =>
	drawShape(id, "wire", { x, y }, { x: endX, y: endY });
const label = (id: number, text: string, x: number, y: number, electrical: TextShape["electrical"] = "net"): TextShape => ({
	id, kind: "text", text, electrical, x, y, width: 8, height: 2,
	fontSize: 1.5, lineWidth: 0.2, rotation: 0,
	horizontalAlign: "left", verticalAlign: "bottom",
});
const netForWire = (shapes: EditorShape[], id: number) => {
	const net = electricalNets(shapes).find((net) => net.wires.includes(id));
	assert.ok(net, `Missing net for wire ${id}`);
	return net;
};

test("matching named nets and supply names join disconnected wire sections", () => {
	const shapes = [wire(1, 0, 0, 10), wire(2, 30, 10, 40),
		label(3, "+3V3", 0, 0), label(4, "+3V3", 40, 10, "supply")];
	const net = netForWire(shapes, 1);
	assert.deepEqual(new Set(net.wires), new Set([1, 2]));
	assert.deepEqual(new Set(net.labels), new Set([3, 4]));
	assert.deepEqual(net.names, ["+3V3"]);
});

test("different names and differently cased names remain separate", () => {
	const shapes = [wire(1, 0, 0, 10), wire(2, 30, 0, 40), wire(3, 60, 0, 70),
		label(4, "GND", 0, 0), label(5, "VCC", 30, 0), label(6, "gnd", 60, 0)];
	for (const id of [1, 2, 3]) assert.deepEqual(netForWire(shapes, id).wires, [id]);
});

test("ordinary text matching a net name has no electrical meaning", () => {
	const ordinary = label(4, "GND", 30, 0);
	delete ordinary.electrical;
	const shapes = [wire(1, 0, 0, 10), wire(2, 30, 0, 40), label(3, "GND", 0, 0), ordinary];
	assert.deepEqual(netForWire(shapes, 1).wires, [1]);
	assert.deepEqual(netForWire(shapes, 2).wires, [2]);
	assert.ok(electricalNets(shapes).every((net) => !net.labels.includes(4)));
});

test("only the label anchor attaches, including at wire interiors and rotated text", () => {
	const shapes = [wire(1, 0, 0, 20), wire(2, 40, 0, 60), wire(3, 80, 0, 100),
		label(4, "RUN", 10, 0), { ...label(5, "RUN", 50, 0), rotation: Math.PI / 2 },
		label(6, "RUN", 90, 1)];
	assert.deepEqual(new Set(netForWire(shapes, 1).wires), new Set([1, 2]));
	assert.deepEqual(netForWire(shapes, 3).wires, [3]);
});

test("a label anchors to a pin terminal and aliases a remote wire", () => {
	const pin = drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
	const shapes = [pin, wire(2, 30, 0, 40), label(3, "IO", 0, 0), label(4, "IO", 30, 0)];
	assert.deepEqual(netForWire(shapes, 2).pins, [{ shapeId: 1, pinId: 1 }]);
});

test("bare crossings stay separate and endpoint junctions conduct", () => {
	const crossing = [wire(1, -10, 0, 10), wire(2, 0, -10, 0, 10),
		label(3, "HORIZONTAL", -10, 0), label(4, "VERTICAL", 0, -10)];
	assert.deepEqual(netForWire(crossing, 1).wires, [1]);
	assert.deepEqual(new Set(netForWire([wire(1, 0, 0, 20), wire(2, 10, 0, 10, 10)], 1).wires), new Set([1, 2]));
});

test("wire bridges propagate multiple aliases transitively", () => {
	const shapes = [wire(1, 0, 0, 10), wire(2, 30, 0, 40), wire(3, 60, 0, 70),
		label(4, "A", 0, 0), label(5, "A", 30, 0), label(6, "B", 40, 0), label(7, "B", 60, 0)];
	const net = netForWire(shapes, 1);
	assert.deepEqual(new Set(net.wires), new Set([1, 2, 3]));
	assert.deepEqual(new Set(net.names), new Set(["A", "B"]));
});

test("named nets survive drawing save, reload, rename, and undo", () => {
	const shapes = [wire(1, 0, 0, 10), wire(2, 30, 0, 40), label(3, "GND", 0, 0), label(4, "GND", 30, 0, "supply")];
	const document = validateProjectDocument(JSON.parse(JSON.stringify({ shapes, symbols: [] })));
	assert.deepEqual(document.shapes, shapes);
	assert.deepEqual(new Set(netForWire(document.shapes, 1).wires), new Set([1, 2]));
	const store = createDrawingStore();
	const run = <A, E>(effect: Effect.Effect<A, E, DrawingStore>) => Effect.runSync(Effect.provideService(effect, DrawingStore, store));
	run(placeShapesEffect(shapes, "Named nets"));
	const snapshot = drawingSnapshotSchema.parse(JSON.parse(JSON.stringify(store.getSnapshot())));
	const restored = restoreDrawingStore(snapshot);
	assert.deepEqual(restored.getSnapshot(), store.getSnapshot());
	run(replaceShapesEffect([{ ...label(4, "VCC", 30, 0, "supply") }], "Rename supply"));
	assert.deepEqual(netForWire(store.getSnapshot().shapes, 1).wires, [1]);
	run(undoEffect);
	assert.deepEqual(new Set(netForWire(store.getSnapshot().shapes, 1).wires), new Set([1, 2]));
});

test("old drawing text reloads without gaining electrical semantics", () => {
	const text = label(1, "GND", 0, 0);
	delete text.electrical;
	assert.deepEqual(drawingShapeSchema.parse(text), text);
	assert.deepEqual(validateProjectDocument({ shapes: [text], symbols: [] }).shapes, [text]);
});

test("rotated symbol terminals remain distinct and use world coordinates", () => {
	const symbol: EditorShape = {
		id: 1, kind: "symbol", definitionId: "test-two-pin", x: 50, y: 50,
		width: 10, height: 10, rotation: Math.PI / 2, lineWidth: 0.2,
		children: [
			{ ...drawShape(11, "pin", { x: -5, y: 0 }, { x: -5, y: 0 }) },
			{ ...drawShape(12, "pin", { x: 5, y: 0 }, { x: 5, y: 0 }) },
		],
		texts: [], attributes: { name: "Two pin", reference: "U1", value: "" },
	};
	const shapes = [symbol, wire(2, 100, 0, 110), wire(3, 130, 0, 140),
		label(4, "A", 50, 45), label(5, "A", 100, 0),
		label(6, "B", 50, 55), label(7, "B", 130, 0)];
	assert.deepEqual(netForWire(shapes, 2).pins, [{ shapeId: 1, pinId: 11 }]);
	assert.deepEqual(netForWire(shapes, 3).pins, [{ shapeId: 1, pinId: 12 }]);
	assert.deepEqual(netForWire(shapes, 2).wires, [2]);
	assert.deepEqual(netForWire(shapes, 3).wires, [3]);
});

test("surrounding name whitespace does not split a named net", () => {
	const shapes = [wire(1, 0, 0, 10), wire(2, 30, 0, 40),
		label(3, "  GND  ", 0, 0), label(4, "GND", 30, 0)];
	const net = netForWire(shapes, 1);
	assert.deepEqual(new Set(net.wires), new Set([1, 2]));
	assert.deepEqual(net.names, ["GND"]);
});

test("wire tools use electrical anchors while ordinary text stays inert", async () => {
	const { findWireConnection, openWireEnds, wireConnectionPoints } = await import("#/drawing/shapes.ts");
	const shapes = [wire(1, 0, 0, 10), label(2, "GND", 0, 0), label(3, "GND", 30, 0)];
	assert.deepEqual(openWireEnds(shapes).map(end => end.point), [{ x: 10, y: 0 }]);
	assert.deepEqual(findWireConnection(shapes, { x: 30.2, y: 0.1 }, 1), { x: 30, y: 0 });
	assert.ok(wireConnectionPoints(shapes).some(point => point.x === 30 && point.y === 0));
	const ordinary = label(4, "GND", 60, 0);
	delete ordinary.electrical;
	assert.equal(findWireConnection([ordinary], { x: 60, y: 0 }, 1), undefined);
});

test("grouping cannot hide electrical labels inside symbol definitions", async () => {
	const { createSymbolFromSelectionEffect } = await import("#/commands/drawing-commands.ts");
	const store = createDrawingStore([label(1, "GND", 0, 0), wire(2, 0, 0, 10)]);
	const before = store.getSnapshot();
	assert.throws(() => Effect.runSync(createSymbolFromSelectionEffect([1, 2]).pipe(Effect.provideService(DrawingStore, store))), /Electrical labels must remain standalone/);
	assert.equal(store.getSnapshot(), before);
});
