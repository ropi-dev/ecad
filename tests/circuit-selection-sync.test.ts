import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { applyCircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import {
	drawShape,
	type EditorShape,
	type EditorSymbol,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { symbolShapes } from "@ecad/drawing-core/drawing/symbol-instances.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import {
	circuitSelectionFromSchematic,
	pruneCircuitSelection,
	sameCircuitSelection,
	sameSchematicSelection,
	schematicSelectionFromCircuit,
} from "#/circuit/selection-sync.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "./helpers/required.ts";

const resistor = required(
	symbolDefinitions.find((definition) => definition.id === "resistor"),
);

function linkedPair() {
	let file = createCircuit("Board");
	const a = componentFromSymbol(resistor, []);
	const b = componentFromSymbol(resistor, [a]);
	file = applyCircuitCommand(file, { type: "add-component", component: a });
	file = applyCircuitCommand(file, { type: "add-component", component: b });
	const placed = synchronizePcb(
		file,
		[],
		createCircuit("Board", file.circuit.id),
		symbolDefinitions,
	);
	const connected = applyCircuitCommand(placed.file, {
		type: "connect",
		pinIds: [a.pins[0].id, b.pins[0].id],
	});
	const synced = synchronizePcb(
		connected,
		placed.shapes,
		placed.file,
		symbolDefinitions,
	);
	const components = synced.file.circuit.components;
	const symbolOf = (index: number) =>
		required(
			synced.shapes.find(
				(shape): shape is EditorSymbol =>
					shape.kind === "symbol" &&
					shape.id === components[index].schematicShapeId,
			),
		);
	const net = required(synced.file.circuit.nets[0]);
	const labels = synced.shapes.filter(
		(shape) => shape.kind === "text" && shape.circuitNet?.id === net.id,
	);
	return { file: synced.file, shapes: synced.shapes, symbolOf, net, labels };
}

function pinTerminal(symbol: EditorSymbol, sourcePinId: string) {
	const pin = required(
		symbolShapes(symbol).find(
			(child) => child.kind === "pin" && String(child.id) === sourcePinId,
		),
	);
	return { x: pin.x, y: pin.y };
}

test("schematic symbols, pins and labels select their circuit counterparts", () => {
	const { file, shapes, symbolOf, net, labels } = linkedPair();
	const [a] = file.circuit.components;
	const r1 = symbolOf(0);
	assert.deepEqual(
		circuitSelectionFromSchematic(shapes, file, {
			shapeIds: [r1.id],
			childKey: null,
		}),
		{ kind: "component", id: a.id },
	);
	const pin = required(a.pins[0].sourcePinId);
	assert.deepEqual(
		circuitSelectionFromSchematic(shapes, file, {
			shapeIds: [r1.id],
			childKey: `shape:${pin}`,
		}),
		{ kind: "pin", id: a.pins[0].id },
	);
	assert.deepEqual(
		circuitSelectionFromSchematic(shapes, file, {
			shapeIds: labels.map((label) => label.id),
			childKey: null,
		}),
		{ kind: "net", id: net.id },
	);
	assert.equal(
		circuitSelectionFromSchematic(shapes, file, {
			shapeIds: [r1.id, symbolOf(1).id],
			childKey: null,
		}),
		null,
	);
	assert.equal(
		circuitSelectionFromSchematic(shapes, file, {
			shapeIds: [9999],
			childKey: null,
		}),
		null,
	);
	const collapsed = {
		...file,
		graph: { ...file.graph, collapsedComponentIds: [a.id] },
	};
	assert.deepEqual(
		circuitSelectionFromSchematic(shapes, collapsed, {
			shapeIds: [r1.id],
			childKey: `shape:${pin}`,
		}),
		{ kind: "component", id: a.id },
	);
});

test("a schematic wire selects the net its pins belong to", () => {
	const { file, shapes, symbolOf, net } = linkedPair();
	const r1 = symbolOf(0);
	const start = pinTerminal(
		r1,
		required(file.circuit.components[0].pins[0].sourcePinId),
	);
	const nextId = Math.max(...shapes.map((shape) => shape.id)) + 1;
	const wire = drawShape(nextId, "wire", start, {
		x: start.x,
		y: start.y + 20,
	});
	const withWire: EditorShape[] = [...shapes, wire];
	assert.deepEqual(
		circuitSelectionFromSchematic(withWire, file, {
			shapeIds: [wire.id],
			childKey: null,
		}),
		{ kind: "net", id: net.id },
	);
	const selected = schematicSelectionFromCircuit(withWire, file.circuit, {
		item: { kind: "net", id: net.id },
		checkedPins: [],
	});
	assert.ok(selected.shapeIds.includes(wire.id));
	assert.ok(!selected.shapeIds.includes(r1.id));
});

test("circuit components, pins and nets select their schematic shapes", () => {
	const { file, shapes, symbolOf, net, labels } = linkedPair();
	const [a, b] = file.circuit.components;
	const r1 = symbolOf(0);
	assert.deepEqual(
		schematicSelectionFromCircuit(shapes, file.circuit, {
			item: { kind: "component", id: a.id },
			checkedPins: [],
		}),
		{ shapeIds: [r1.id], childKey: null },
	);
	assert.deepEqual(
		schematicSelectionFromCircuit(shapes, file.circuit, {
			item: { kind: "pin", id: a.pins[0].id },
			checkedPins: [],
		}),
		{ shapeIds: [r1.id], childKey: `shape:${a.pins[0].sourcePinId}` },
	);
	assert.deepEqual(
		schematicSelectionFromCircuit(shapes, file.circuit, {
			item: { kind: "connection", id: a.pins[0].id },
			checkedPins: [a.pins[0].id, b.pins[0].id],
		}),
		{
			shapeIds: [r1.id, symbolOf(1).id].sort((x, y) => x - y),
			childKey: null,
		},
	);
	assert.deepEqual(
		schematicSelectionFromCircuit(shapes, file.circuit, {
			item: { kind: "connection", id: a.pins[0].id },
			checkedPins: [b.pins[0].id],
		}),
		{ shapeIds: [r1.id], childKey: `shape:${a.pins[0].sourcePinId}` },
	);
	assert.deepEqual(
		schematicSelectionFromCircuit(shapes, file.circuit, {
			item: { kind: "net", id: net.id },
			checkedPins: [],
		}),
		{
			shapeIds: labels.map((label) => label.id).sort((x, y) => x - y),
			childKey: null,
		},
	);
	assert.deepEqual(
		schematicSelectionFromCircuit(shapes, file.circuit, {
			item: { kind: "component", id: "missing" },
			checkedPins: [],
		}),
		{ shapeIds: [], childKey: null },
	);
});

test("restored circuit selections drop items that no longer exist or are hidden", () => {
	const { file, net } = linkedPair();
	const [a, b] = file.circuit.components;
	const collapsed = {
		...file,
		graph: { ...file.graph, collapsedComponentIds: [a.id] },
	};
	assert.deepEqual(
		pruneCircuitSelection(file, {
			item: { kind: "component", id: "missing" },
			checkedPins: [],
		}),
		{ item: null, checkedPins: [] },
	);
	assert.deepEqual(
		pruneCircuitSelection(file, {
			item: { kind: "net", id: net.id },
			checkedPins: [a.pins[0].id],
		}),
		{ item: { kind: "net", id: net.id }, checkedPins: [] },
	);
	assert.deepEqual(
		pruneCircuitSelection(collapsed, {
			item: { kind: "pin", id: a.pins[0].id },
			checkedPins: [],
		}),
		{ item: null, checkedPins: [] },
	);
	const connections = {
		item: { kind: "connection" as const, id: b.pins[0].id },
		checkedPins: [a.pins[0].id, b.pins[0].id, a.pins[1].id],
	};
	assert.deepEqual(pruneCircuitSelection(file, connections), {
		item: connections.item,
		checkedPins: [a.pins[0].id, b.pins[0].id],
	});
	assert.deepEqual(
		pruneCircuitSelection(collapsed, {
			item: { kind: "connection", id: a.pins[0].id },
			checkedPins: [a.pins[0].id, b.pins[0].id],
		}),
		{ item: null, checkedPins: [] },
	);
});

test("selection equality compares contents, not identity", () => {
	assert.ok(
		sameSchematicSelection(
			{ shapeIds: [1, 2], childKey: null },
			{ shapeIds: [1, 2], childKey: null },
		),
	);
	assert.ok(
		!sameSchematicSelection(
			{ shapeIds: [1], childKey: "shape:3" },
			{ shapeIds: [1], childKey: null },
		),
	);
	assert.ok(
		sameCircuitSelection(
			{ item: { kind: "net", id: "n" }, checkedPins: [] },
			{ item: { kind: "net", id: "n" }, checkedPins: [] },
		),
	);
	assert.ok(
		!sameCircuitSelection(
			{ item: { kind: "connection", id: "p" }, checkedPins: ["p"] },
			{ item: { kind: "connection", id: "p" }, checkedPins: ["p", "q"] },
		),
	);
	assert.ok(
		sameCircuitSelection(
			{ item: null, checkedPins: [] },
			{ item: null, checkedPins: [] },
		),
	);
});
