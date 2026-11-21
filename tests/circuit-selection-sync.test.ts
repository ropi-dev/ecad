import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import {
	applyCircuitCommand,
	createCircuitStore,
} from "@ecad/drawing-core/circuit/store.ts";
import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	drawShape,
	type EditorShape,
	type EditorSymbol,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { symbolShapes } from "@ecad/drawing-core/drawing/symbol-instances.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import {
	boardSelectionFromComponents,
	boardSelectionFromNet,
	boardSelectionFromSource,
	circuitSelectionFromBoard,
	circuitSelectionFromComponents,
	circuitSelectionFromSchematic,
	componentsOfBoardSelection,
	componentsOfCircuitSelection,
	componentsOfSchematicSelection,
	netOfBoardSelection,
	schematicSelectionFromBoard,
	schematicSelectionFromCircuit,
	schematicSelectionFromComponents,
} from "#/circuit/selection-sync.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import {
	closeSplitPane,
	openThreePaneSplit,
	openTwoPaneSplit,
	resizeSplitSizes,
	switchPaneView,
} from "#/projects/split-layout.ts";
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

function linkedBoard() {
	const pair = linkedPair();
	const [a, b] = pair.file.circuit.components;
	const footprint = (id: number, component: string): EditorShape => ({
		...pair.symbolOf(0),
		id,
		footprint: { library: "builtin", id: "R_0603" },
		component,
	});
	const copper = (id: number, net: string): EditorShape =>
		({
			...drawShape(id, "line", { x: 0, y: id }, { x: 5, y: id }),
			layer: "F.Cu",
			net,
		}) as EditorShape;
	const footprints = [footprint(1, a.id), footprint(2, b.id)];
	const routed = [
		...footprints,
		copper(5, pair.net.id),
		copper(6, pair.net.id),
		copper(7, "other"),
	];
	return { ...pair, footprints, routed };
}

test("PCB copper selects its net in the schematic and circuit, and a selected footprint selects its component instead", () => {
	const { file, shapes, net, labels, routed } = linkedBoard();
	const [a] = file.circuit.components;
	const select = (...shapeIds: number[]) => ({ shapeIds, childKey: null });
	assert.equal(netOfBoardSelection(routed, select(5, 6)), net.id);
	assert.equal(netOfBoardSelection(routed, select(5, 7)), null);
	assert.equal(netOfBoardSelection(routed, select(1, 5)), null);
	assert.deepEqual(boardSelectionFromNet(routed, net.id), select(5, 6));
	assert.deepEqual(circuitSelectionFromBoard(routed, file.circuit, select(5)), {
		item: { kind: "net", id: net.id },
		checkedPins: [],
	});
	assert.deepEqual(
		circuitSelectionFromBoard(routed, file.circuit, select(1, 5)),
		{ item: { kind: "component", id: a.id }, checkedPins: [] },
	);
	assert.deepEqual(
		schematicSelectionFromBoard(shapes, routed, file.circuit, select(6)),
		select(...labels.map((label) => label.id).sort((x, y) => x - y)),
	);
});

test("a net chosen in the schematic or circuit selects its PCB copper, and still names the net on an unrouted board", () => {
	const { file, shapes, net, labels, symbolOf, routed, footprints } =
		linkedBoard();
	const [a] = file.circuit.components;
	const circuit = (item: { kind: "net" | "component"; id: string }) => ({
		view: "circuit" as const,
		store: createCircuitStore(file),
		selection: { item, checkedPins: [] },
	});
	const schematic = (shapeIds: number[]) => ({
		view: "schematic" as const,
		store: createDrawingStore(shapes),
		selection: { shapeIds, childKey: null },
	});
	const copper = {
		selection: { shapeIds: [5, 6], childKey: null },
		netId: net.id,
	};
	assert.deepEqual(
		boardSelectionFromSource(
			routed,
			circuit({ kind: "net", id: net.id }),
			file,
		),
		copper,
	);
	assert.deepEqual(
		boardSelectionFromSource(
			routed,
			schematic(labels.map((label) => label.id)),
			file,
		),
		copper,
	);
	assert.deepEqual(
		boardSelectionFromSource(
			footprints,
			circuit({ kind: "net", id: net.id }),
			file,
		),
		{ selection: { shapeIds: [], childKey: null }, netId: net.id },
	);
	assert.deepEqual(
		boardSelectionFromSource(routed, schematic([symbolOf(0).id]), file),
		{ selection: { shapeIds: [1], childKey: null }, netId: null },
	);
	assert.deepEqual(
		boardSelectionFromSource(
			routed,
			circuit({ kind: "component", id: a.id }),
			file,
		),
		{ selection: { shapeIds: [1], childKey: null }, netId: null },
	);
});

test("split view panes open beside the current view, swap, close to the nearest pane and resize within their limits", () => {
	assert.deepEqual(openTwoPaneSplit("schematic", true), ["schematic", "pcb"]);
	assert.deepEqual(openTwoPaneSplit("schematic", false), [
		"schematic",
		"circuit",
	]);
	assert.deepEqual(openTwoPaneSplit("pcb", true), ["pcb", "schematic"]);
	assert.deepEqual(openThreePaneSplit(["pcb", "schematic"]), [
		"pcb",
		"schematic",
		"circuit",
	]);
	assert.deepEqual(openThreePaneSplit(["circuit"]), [
		"schematic",
		"circuit",
		"pcb",
	]);
	assert.deepEqual(switchPaneView(["schematic", "pcb"], 0, "pcb"), [
		"pcb",
		"schematic",
	]);
	assert.deepEqual(switchPaneView(["schematic", "pcb"], 1, "circuit"), [
		"schematic",
		"circuit",
	]);
	assert.deepEqual(
		closeSplitPane(["schematic", "circuit", "pcb"], 1, "circuit"),
		{ panes: ["schematic", "pcb"], focused: "pcb" },
	);
	assert.deepEqual(closeSplitPane(["schematic", "pcb"], 1, "schematic"), {
		panes: ["schematic"],
		focused: "schematic",
	});
	const near = (actual: number[], expected: number[]) =>
		assert.ok(
			actual.length === expected.length &&
				actual.every((size, index) => Math.abs(size - expected[index]) < 1e-9),
			`${actual} is not ${expected}`,
		);
	near(resizeSplitSizes([0.5, 0.5], 0, 0.1, 0.2), [0.6, 0.4]);
	near(resizeSplitSizes([0.5, 0.5], 0, 0.6, 0.2), [0.8, 0.2]);
	near(resizeSplitSizes([1 / 3, 1 / 3, 1 / 3], 1, -1, 0.1), [
		1 / 3,
		0.1,
		2 / 3 - 0.1,
	]);
});
