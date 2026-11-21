import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { applyCircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import {
	drawShape,
	type EditorShape,
	type EditorSymbol,
	type FillableShape,
	type LineShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { symbolShapes } from "@ecad/drawing-core/drawing/symbol-instances.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import {
	boardSelectionFromComponents,
	boardSelectionFromNet,
	circuitSelectionFromComponents,
	circuitSelectionFromSchematic,
	componentsOfBoardSelection,
	componentsOfCircuitSelection,
	componentsOfSchematicSelection,
	netOfBoardSelection,
	schematicSelectionFromCircuit,
	schematicSelectionFromComponents,
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

test("PCB footprints select the same components in the schematic and circuit", () => {
	const { file, shapes, symbolOf } = linkedPair();
	const [a, b] = file.circuit.components;
	const footprint = (id: number, component?: string): EditorShape => ({
		...symbolOf(0),
		id,
		footprint: { library: "builtin", id: "R_0603" },
		...(component ? { component } : {}),
	});
	const board = [
		footprint(1, a.id),
		footprint(2, b.id),
		footprint(3),
		drawShape(4, "rectangle", { x: 0, y: 0 }, { x: 1, y: 1 }),
	];
	assert.deepEqual(
		componentsOfBoardSelection(board, { shapeIds: [1, 3, 4], childKey: null }),
		[a.id],
	);
	assert.deepEqual(boardSelectionFromComponents(board, [b.id, a.id]), {
		shapeIds: [1, 2],
		childKey: null,
	});
	assert.deepEqual(
		schematicSelectionFromComponents(shapes, file.circuit, [b.id]),
		{ shapeIds: [symbolOf(1).id], childKey: null },
	);
	assert.deepEqual(
		componentsOfSchematicSelection(file.circuit, {
			shapeIds: [symbolOf(0).id, symbolOf(1).id],
			childKey: null,
		}),
		[a.id, b.id],
	);
	assert.deepEqual(
		componentsOfCircuitSelection(file.circuit, {
			item: { kind: "pin", id: b.pins[1].id },
			checkedPins: [],
		}),
		[b.id],
	);
	assert.deepEqual(
		componentsOfCircuitSelection(file.circuit, {
			item: { kind: "connection", id: a.pins[0].id },
			checkedPins: [a.pins[0].id, b.pins[0].id],
		}),
		[a.id, b.id],
	);
	assert.deepEqual(circuitSelectionFromComponents([a.id]), {
		item: { kind: "component", id: a.id },
		checkedPins: [],
	});
	assert.deepEqual(circuitSelectionFromComponents([a.id, b.id]), {
		item: null,
		checkedPins: [],
	});
});

test("PCB tracks, vias and zones sync their net, while footprints take precedence", () => {
	const { file, symbolOf, net } = linkedPair();
	const [a, b] = file.circuit.components;
	const withTwoNets = applyCircuitCommand(file, {
		type: "connect",
		pinIds: [a.pins[1].id, b.pins[1].id],
	});
	const otherNet = required(
		withTwoNets.circuit.nets.find((entry) => entry.id !== net.id),
	);
	const footprint: EditorShape = {
		...symbolOf(0),
		id: 1,
		footprint: { library: "builtin", id: "R_0603" },
		component: a.id,
	};
	const track: LineShape = {
		kind: "line",
		id: 10,
		x: 2.5,
		y: 0,
		width: 5,
		height: 0.25,
		rotation: 0,
		lineWidth: 0.25,
		layer: "F.Cu",
		net: net.id,
	};
	const via: FillableShape = {
		kind: "circle",
		id: 11,
		x: 5,
		y: 0,
		width: 0.6,
		height: 0.6,
		rotation: 0,
		lineWidth: 0.1,
		layer: "F.Cu",
		via: { drill: 0.3 },
		net: net.id,
	};
	const zone: FillableShape = {
		kind: "rectangle",
		id: 12,
		x: 5,
		y: 5,
		width: 10,
		height: 10,
		rotation: 0,
		lineWidth: 0.1,
		layer: "F.Cu",
		zone: {
			clearance: 0.2,
			padConnection: "thermal",
			thermalGap: 0.3,
			thermalSpokeWidth: 0.3,
		},
		net: net.id,
	};
	const otherTrack: LineShape = {
		kind: "line",
		id: 13,
		x: 2.5,
		y: 2,
		width: 5,
		height: 0.25,
		rotation: 0,
		lineWidth: 0.25,
		layer: "F.Cu",
		net: otherNet.id,
	};
	const board = [footprint, track, via, zone, otherTrack];
	assert.equal(
		netOfBoardSelection(board, withTwoNets.circuit, {
			shapeIds: [],
			childKey: null,
		}),
		null,
	);
	assert.equal(
		netOfBoardSelection(board, withTwoNets.circuit, {
			shapeIds: [10, 11, 12],
			childKey: null,
		}),
		net.id,
	);
	assert.equal(
		netOfBoardSelection(board, withTwoNets.circuit, {
			shapeIds: [10, 1],
			childKey: null,
		}),
		null,
	);
	assert.equal(
		netOfBoardSelection(board, withTwoNets.circuit, {
			shapeIds: [10, 13],
			childKey: null,
		}),
		null,
	);
	assert.deepEqual(boardSelectionFromNet(board, net.id), {
		shapeIds: [10, 11, 12],
		childKey: null,
	});
});
