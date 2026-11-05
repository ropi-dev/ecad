import assert from "node:assert/strict";
import { test } from "node:test";
import {
	circuitFileSchema,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import { applyCircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { pairPcbDocuments } from "#/projects/pcb.ts";
import { required } from "./helpers/required.ts";

const resistor = required(
	symbolDefinitions.find((definition) => definition.id === "resistor"),
);
test("schematic instances keep component and pin identities through edits and duplication", () => {
	const original = createCircuit("Board");
	const symbol = createSymbol(1, resistor, { x: 0, y: 0 }, "R1");
	const first = synchronizePcb(original, [symbol], original, symbolDefinitions);
	const second = synchronizePcb(
		first.file,
		[
			{ ...symbol, x: 50, attributes: { ...symbol.attributes, value: "10k" } },
			createSymbol(2, resistor, { x: 100, y: 0 }, "R2"),
		],
		first.file,
		symbolDefinitions,
	);
	assert.equal(second.file.circuit.components.length, 2);
	assert.equal(
		second.file.circuit.components[0].id,
		first.file.circuit.components[0].id,
	);
	assert.deepEqual(
		second.file.circuit.components[0].pins,
		first.file.circuit.components[0].pins,
	);
	assert.equal(second.file.circuit.components[0].value, "10k");
	circuitFileSchema.parse(second.file);
});
test("circuit placements, connections, renames and deletion reach the schematic and round trip", () => {
	let file = createCircuit("Board");
	const a = componentFromSymbol(resistor, []),
		b = componentFromSymbol(resistor, [a]);
	file = applyCircuitCommand(file, { type: "add-component", component: a });
	file = applyCircuitCommand(file, { type: "add-component", component: b });
	const first = synchronizePcb(
		file,
		[],
		createCircuit("Board", file.circuit.id),
		symbolDefinitions,
	);
	assert.equal(
		first.shapes.filter((shape) => shape.kind === "symbol").length,
		2,
	);
	const connected = applyCircuitCommand(first.file, {
		type: "connect",
		pinIds: [a.pins[0].id, b.pins[0].id],
	});
	const second = synchronizePcb(
		connected,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	assert.equal(
		second.shapes.filter((shape) => shape.kind === "text").length,
		2,
	);
	const roundtrip = synchronizePcb(
		second.file,
		second.shapes,
		second.file,
		symbolDefinitions,
	);
	assert.deepEqual(roundtrip.file.circuit.nets, second.file.circuit.nets);
	const renamed = applyCircuitCommand(second.file, {
		type: "update-component",
		id: a.id,
		reference: "R9",
		value: "4k7",
	});
	const third = synchronizePcb(
		renamed,
		second.shapes,
		second.file,
		symbolDefinitions,
	);
	assert.ok(
		third.shapes.some(
			(shape) => shape.kind === "symbol" && shape.attributes.reference === "R9",
		),
	);
	const removed = applyCircuitCommand(third.file, {
		type: "remove-component",
		id: a.id,
	});
	const fourth = synchronizePcb(
		removed,
		third.shapes,
		third.file,
		symbolDefinitions,
	);
	assert.equal(
		fourth.shapes.filter((shape) => shape.kind === "symbol").length,
		1,
	);
	circuitFileSchema.parse(fourth.file);
});
test("PCB pairing is stable and leaves inputs untouched", () => {
	const input = {
		shapes: [],
		symbols: [],
		drawings: [{ id: "board", name: "Board", shapes: [] }],
	};
	const paired = pairPcbDocuments(input, "Project");
	assert.equal(paired.circuits?.length, 2);
	assert.deepEqual(pairPcbDocuments(paired, "Project"), paired);
	assert.equal("circuitId" in input.drawings[0], false);
});

test("legacy circuit pins and connections survive repeated synchronization", async () => {
	const { createTestCircuit } = await import("./fixtures/circuit.ts");
	const original = createTestCircuit();
	const first = synchronizePcb(original, [], original, symbolDefinitions);
	assert.ok(
		first.shapes.some((shape) => shape.kind === "text" && shape.electrical),
	);
	const { drawingFileSchema } = await import("#/projects/format.ts");
	drawingFileSchema.parse({ id: "board", name: "Board", shapes: first.shapes });
	const next = synchronizePcb(
		first.file,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	assert.deepEqual(next.file.circuit.nets, first.file.circuit.nets);
	const stable = synchronizePcb(
		next.file,
		next.shapes,
		next.file,
		symbolDefinitions,
	);
	assert.deepEqual(stable.file.circuit, next.file.circuit);
});

test("standalone named and unnamed nets retain their identities", () => {
	const original = createCircuit("Board");
	const file = structuredClone(original);
	file.circuit.nets = [
		{ id: "ground", names: ["GND"], pinIds: [] },
		{ id: "spare", names: [], pinIds: [] },
	];
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	const next = synchronizePcb(
		first.file,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	assert.deepEqual(next.file.circuit.nets, file.circuit.nets);
});

test("placing a circuit component keeps existing schematic wire geometry", async () => {
	const { drawShape } = await import("@ecad/drawing-core/drawing/shapes.ts");
	const original = createCircuit("Board");
	const wire = drawShape(3, "wire", { x: 3, y: 0 }, { x: 7, y: 0 });
	const first = synchronizePcb(
		original,
		[
			createSymbol(1, resistor, { x: 0, y: 0 }, "R1"),
			createSymbol(2, resistor, { x: 10, y: 0 }, "R2"),
			wire,
		],
		original,
		symbolDefinitions,
	);
	const added = applyCircuitCommand(first.file, {
		type: "add-component",
		component: componentFromSymbol(resistor, first.file.circuit.components),
	});
	const next = synchronizePcb(
		added,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	assert.deepEqual(
		next.shapes.find((shape) => shape.id === 3),
		wire,
	);
});

test("automatic labels use readable circuit names, natural sizing and outward alignment", () => {
	const original = createCircuit("Labels");
	const file = structuredClone(original);
	const left = componentFromSymbol(resistor, []),
		right = componentFromSymbol(resistor, [left]);
	file.circuit.components = [left, right];
	file.circuit.nets = [
		{
			id: crypto.randomUUID(),
			names: [],
			pinIds: [left.pins[1].id, right.pins[0].id],
		},
	];
	const linked = synchronizePcb(file, [], original, symbolDefinitions);
	const labels = linked.shapes.filter((shape) => shape.kind === "text");
	assert.equal(labels.length, 2);
	assert.ok(
		labels.every((label) => label.text === "R1.2 / R2.1" && label.width > 7),
	);
	assert.equal(labels[0].horizontalAlign, "left");
	assert.equal(labels[1].horizontalAlign, "right");
	assert.ok(labels.every((label) => label.verticalAlign === "bottom"));
	const roundtrip = synchronizePcb(
		linked.file,
		linked.shapes,
		linked.file,
		symbolDefinitions,
	);
	assert.deepEqual(roundtrip.file.circuit.nets, file.circuit.nets);
});

test("schematic reference edits refresh automatic labels without turning them into explicit net names", () => {
	const original = createCircuit("References");
	const file = structuredClone(original);
	const component = componentFromSymbol(resistor, []);
	file.circuit.components = [component];
	file.circuit.nets = [
		{ id: "signal", names: [], pinIds: [component.pins[0].id] },
	];
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	const edited = first.shapes.map((shape) =>
		shape.kind === "symbol"
			? { ...shape, attributes: { ...shape.attributes, reference: "R9" } }
			: shape,
	);
	const next = synchronizePcb(
		first.file,
		edited,
		first.file,
		symbolDefinitions,
	);
	assert.equal(
		next.shapes.find((shape) => shape.kind === "text")?.text,
		"R9.1",
	);
	assert.deepEqual(next.file.circuit.nets, file.circuit.nets);
	const stable = synchronizePcb(
		next.file,
		next.shapes,
		next.file,
		symbolDefinitions,
	);
	assert.deepEqual(stable.file.circuit.nets, file.circuit.nets);
});

test("schematic deletions preserve an anonymous net identity and remove stale membership", () => {
	const original = createCircuit("Deletion");
	const file = structuredClone(original);
	const a = componentFromSymbol(resistor, []),
		b = componentFromSymbol(resistor, [a]);
	file.circuit.components = [a, b];
	file.circuit.nets = [
		{ id: "signal", names: [], pinIds: [a.pins[0].id, b.pins[0].id] },
	];
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	const removed = first.shapes.filter(
		(shape) => shape.id !== first.file.circuit.components[0].schematicShapeId,
	);
	const next = synchronizePcb(
		first.file,
		removed,
		first.file,
		symbolDefinitions,
	);
	assert.deepEqual(next.file.circuit.nets, [
		{ id: "signal", names: [], pinIds: [b.pins[0].id] },
	]);
	assert.ok(
		next.shapes
			.filter((shape) => shape.kind === "text")
			.every((shape) => shape.text === "R2.1"),
	);
});

test("generated caption provenance survives edits made while a rename save is pending", () => {
	const original = createCircuit("Race");
	const file = structuredClone(original);
	const a = componentFromSymbol(resistor, []),
		b = componentFromSymbol(resistor, [a]);
	file.circuit.components = [a, b];
	file.circuit.nets = [
		{ id: "signal", names: [], pinIds: [a.pins[0].id, b.pins[0].id] },
	];
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	const renamed = first.shapes.map((shape) =>
		shape.kind === "symbol" && shape.attributes.reference === "R1"
			? { ...shape, attributes: { ...shape.attributes, reference: "R9" } }
			: shape,
	);
	const saved = synchronizePcb(
		first.file,
		renamed,
		first.file,
		symbolDefinitions,
	);
	const pending = renamed.map((shape) =>
		shape.kind === "symbol" && shape.attributes.reference === "R9"
			? { ...shape, attributes: { ...shape.attributes, value: "22k" } }
			: shape,
	);
	const next = synchronizePcb(
		saved.file,
		pending,
		saved.file,
		symbolDefinitions,
	);
	assert.deepEqual(next.file.circuit.nets, file.circuit.nets);
	assert.equal(next.file.circuit.components[0].value, "22k");
	assert.ok(
		next.shapes
			.filter((shape) => shape.kind === "text")
			.every((shape) => shape.text === "R2.1 / R9.1"),
	);
});

test("explicit edits to generated captions become net names", () => {
	const original = createCircuit("Named");
	const file = structuredClone(original);
	file.circuit.components = [componentFromSymbol(resistor, [])];
	file.circuit.nets = [
		{
			id: "signal",
			names: [],
			pinIds: [file.circuit.components[0].pins[0].id],
		},
	];
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	const edited = first.shapes.map((shape) =>
		shape.kind === "text" ? { ...shape, text: "SENSE" } : shape,
	);
	const next = synchronizePcb(
		first.file,
		edited,
		first.file,
		symbolDefinitions,
	);
	assert.deepEqual(next.file.circuit.nets[0].names, ["SENSE"]);
});

test("external circuit synchronization invalidates old undo and redo without losing new components", async () => {
	const { createCircuitStore } = await import(
		"@ecad/drawing-core/circuit/store.ts"
	);
	const file = createCircuit("History");
	const a = componentFromSymbol(resistor, []);
	file.circuit.components = [a];
	const store = createCircuitStore(file);
	store.execute({
		type: "update-component",
		id: a.id,
		reference: "R9",
		value: "22k",
	});
	const external = structuredClone(store.getSnapshot());
	external.circuit.components.push(
		componentFromSymbol(resistor, external.circuit.components),
	);
	store.synchronize({ circuit: external.circuit, graph: external.graph });
	store.undo();
	store.redo();
	assert.equal(store.getSnapshot().circuit.components.length, 2);
	assert.equal(store.getSnapshot().canUndo, false);
	assert.equal(store.getSnapshot().canRedo, false);
	store.execute({
		type: "update-component",
		id: a.id,
		reference: "R8",
		value: "22k",
	});
	store.synchronize(
		{ circuit: store.getSnapshot().circuit, graph: store.getSnapshot().graph },
		{ preserveHistory: true },
	);
	store.undo();
	assert.equal(store.getSnapshot().circuit.components[0].reference, "R9");
});

test("legacy LED pins keep their anode and cathode meaning through both projections", async () => {
	const { createTestCircuit } = await import("./fixtures/circuit.ts");
	const original = createTestCircuit();
	const first = synchronizePcb(original, [], original, symbolDefinitions);
	const next = synchronizePcb(
		first.file,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	for (const old of original.circuit.components) {
		const component = required(
			next.file.circuit.components.find((component) => component.id === old.id),
		);
		assert.deepEqual(
			component.pins.map(
				({ sourcePinId: _source, sourcePin: _metadata, ...pin }) => pin,
			),
			old.pins,
		);
	}
	const led = required(
		first.file.circuit.components.find(
			(component) => component.part.id === "led",
		),
	);
	const symbol = required(
		first.shapes.find((shape) => shape.id === led.schematicShapeId),
	);
	assert.equal(symbol.kind, "symbol");
	if (symbol.kind !== "symbol") return;
	const anode = symbol.children.find(
		(child) =>
			child.kind === "pin" &&
			String(child.id) ===
				required(led.pins.find((pin) => pin.number === "A")).sourcePinId,
	);
	assert.ok(anode?.kind === "pin");
	if (anode?.kind === "pin") assert.equal(anode.name, "A");
});

test("standalone net renames reuse their bound caption exactly once", () => {
	const original = createCircuit("Standalone");
	const file = structuredClone(original);
	file.circuit.nets = [{ id: "spare", names: [], pinIds: [] }];
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	const renamed = applyCircuitCommand(first.file, {
		type: "rename-net",
		id: "spare",
		names: ["GND"],
	});
	const next = synchronizePcb(
		renamed,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	assert.equal(next.shapes.length, 1);
	assert.equal(next.shapes[0].kind, "text");
	const stable = synchronizePcb(
		next.file,
		next.shapes,
		next.file,
		symbolDefinitions,
	);
	assert.equal(stable.shapes.length, 1);
});

test("deleting and undoing the last connected component removes the empty-net fallback caption", () => {
	const original = createCircuit("Undo");
	const file = structuredClone(original);
	const a = componentFromSymbol(resistor, []),
		b = componentFromSymbol(resistor, [a]);
	file.circuit.components = [a, b];
	file.circuit.nets = [
		{ id: "signal", names: [], pinIds: [a.pins[1].id, b.pins[0].id] },
	];
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	const disconnected = applyCircuitCommand(first.file, {
		type: "disconnect",
		pinIds: [b.pins[0].id],
	});
	const second = synchronizePcb(
		disconnected,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	const removed = applyCircuitCommand(second.file, {
		type: "remove-component",
		id: a.id,
	});
	const third = synchronizePcb(
		removed,
		second.shapes,
		second.file,
		symbolDefinitions,
	);
	const restored = synchronizePcb(
		second.file,
		third.shapes,
		third.file,
		symbolDefinitions,
	);
	const labels = restored.shapes.filter((shape) => shape.kind === "text");
	assert.equal(labels.length, 1);
	assert.equal(labels[0].circuitNet?.pinId, a.pins[1].id);
	assert.equal(labels[0].text, "R1.2");
});

for (const electrical of [undefined, "supply"] as const)
	test(`converting a generated caption to ${electrical ?? "ordinary text"} preserves the annotation`, () => {
		const original = createCircuit("Role");
		const file = structuredClone(original);
		file.circuit.nets = [{ id: "spare", names: [], pinIds: [] }];
		const first = synchronizePcb(file, [], original, symbolDefinitions);
		const edited = first.shapes.map((shape) =>
			shape.kind === "text" ? { ...shape, electrical } : shape,
		);
		const next = synchronizePcb(
			first.file,
			edited,
			first.file,
			symbolDefinitions,
		);
		assert.equal(next.shapes.length, 1);
		assert.equal(next.shapes[0].kind, "text");
		if (next.shapes[0].kind !== "text") return;
		assert.equal(next.shapes[0].circuitNet, undefined);
		assert.equal(next.shapes[0].text, "Net 1");
		assert.equal(next.shapes[0].electrical, electrical);
		assert.deepEqual(
			next.file.circuit.nets.map((net) => net.names),
			electrical === "supply" ? [["Net 1"]] : [],
		);
	});

test("blank schematic display names still produce valid circuit parts", () => {
	const original = createCircuit("Imported");
	const symbol = createSymbol(1, resistor, { x: 0, y: 0 }, "R1");
	symbol.attributes.name = "";
	const linked = synchronizePcb(
		original,
		[symbol],
		original,
		symbolDefinitions,
	);
	assert.equal(linked.file.circuit.components[0].part.name, "Resistor");
	assert.equal(linked.shapes[0].kind, "symbol");
	if (linked.shapes[0].kind === "symbol")
		assert.equal(linked.shapes[0].attributes.name, "");
});

test("repeated PCB names allocate distinct file names without changing existing documents", async () => {
	const { uniquePcbName } = await import("#/projects/pcb.ts");
	const document = {
		shapes: [],
		symbols: [],
		circuits: [
			createCircuit("Untitled"),
			createCircuit("Power stage"),
			createCircuit("Power stage 2"),
		],
	};
	assert.equal(
		uniquePcbName("Power stage", document, "Untitled"),
		"Power stage 3",
	);
	assert.equal(uniquePcbName("Untitled", document, "Untitled"), "Untitled 2");
	assert.deepEqual(
		document.circuits.map((file) => file.circuit.name),
		["Untitled", "Power stage", "Power stage 2"],
	);
});

test("generated labels move independently with wires and survive synchronization and reopen", async () => {
	const { moveShapes } = await import("@ecad/drawing-core/drawing/shapes.ts");
	const original = createCircuit("Move");
	const file = structuredClone(original);
	const a = componentFromSymbol(resistor, []),
		b = componentFromSymbol(resistor, [a]);
	file.circuit.components = [a, b];
	file.circuit.nets = [
		{ id: "signal", names: [], pinIds: [a.pins[1].id, b.pins[0].id] },
	];
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	for (const kind of ["text", "symbol"] as const) {
		const shape = required(first.shapes.find((shape) => shape.kind === kind));
		const delta = { x: 20, y: -40 };
		const moved = moveShapes([shape], delta, 0, shape, first.shapes);
		const replacements = new Map(moved.map((shape) => [shape.id, shape]));
		const shapes = [
			...first.shapes.map((shape) => replacements.get(shape.id) ?? shape),
			...moved.filter(
				(shape) => !first.shapes.some((old) => old.id === shape.id),
			),
		];
		const next = synchronizePcb(
			first.file,
			shapes,
			first.file,
			symbolDefinitions,
		);
		assert.deepEqual(next.file.circuit.nets, first.file.circuit.nets);
		assert.deepEqual(
			next.shapes.find((candidate) => candidate.id === shape.id),
			moved[0],
		);
		assert.ok(next.shapes.some((shape) => shape.kind === "wire"));
		assert.deepEqual(
			synchronizePcb(next.file, next.shapes, next.file, symbolDefinitions),
			next,
		);
	}
});

test("new drawing circuit IDs avoid the primary PCB and existing unpaired circuits", () => {
	const existing = createCircuit("Existing", "pcb-board");
	const document = {
		shapes: [],
		symbols: [],
		circuits: [existing],
		drawings: [
			{ id: "main", name: "Main", shapes: [] },
			{ id: "board", name: "Board", shapes: [] },
		],
	};
	const paired = pairPcbDocuments(document, "Root");
	assert.deepEqual(
		paired.drawings?.slice(0, 2).map((drawing) => drawing.circuitId),
		["pcb-main-2", "pcb-board-2"],
	);
	assert.equal(
		new Set(paired.circuits?.map((file) => file.circuit.id)).size,
		4,
	);
	assert.deepEqual(
		paired.circuits?.find((file) => file.circuit.id === existing.circuit.id),
		existing,
	);
	assert.deepEqual(pairPcbDocuments(paired, "Root"), paired);
});

test("KiCad units share a component while retaining unit-qualified pin identity", async () => {
	const { importKiCadSchematic } = await import("#/formats/kicad/import.ts");
	const source = `(kicad_sch (version 20250114) (paper "A4")
 (lib_symbols (symbol "Dual"
 (symbol "Dual_1_1" (pin input line (at -3 0 0) (length 2) (name "A") (number "1")) (pin output line (at 3 0 180) (length 2) (name "B") (number "2")))
 (symbol "Dual_2_1" (pin input line (at -3 0 0) (length 2) (name "C") (number "3")) (pin output line (at 3 0 180) (length 2) (name "D") (number "4")))))
 (symbol (lib_id "Dual") (at 10 20 0) (unit 1) (uuid "unit-a") (property "Reference" "U1" (at 10 20 0)) (property "Value" "DUAL" (at 10 21 0)))
 (symbol (lib_id "Dual") (at 30 20 0) (unit 2) (uuid "unit-b") (property "Reference" "U1" (at 30 20 0)) (property "Value" "DUAL" (at 30 21 0)))
 (wire (pts (xy 13 20) (xy 27 20))))`;
	const imported = importKiCadSchematic(source);
	const original = createCircuit("Multi-unit");
	const first = synchronizePcb(
		original,
		imported.shapes,
		original,
		symbolDefinitions,
	);
	assert.equal(first.file.circuit.components.length, 1);
	const component = first.file.circuit.components[0];
	assert.equal(component.reference, "U1");
	assert.equal(component.pins.length, 4);
	assert.equal(component.schematicShapeIds?.length, 2);
	assert.equal(new Set(component.pins.map((pin) => pin.id)).size, 4);
	assert.deepEqual(
		first.file.circuit.nets[0].pinIds
			.map((id) => required(component.pins.find((pin) => pin.id === id)).number)
			.sort(),
		["2", "3"],
	);
	const roundtrip = synchronizePcb(
		first.file,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	assert.deepEqual(roundtrip.file.circuit, first.file.circuit);
	const renamed = applyCircuitCommand(first.file, {
		type: "update-component",
		id: component.id,
		reference: "U9",
		value: "Dual updated",
	});
	const projected = synchronizePcb(
		renamed,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	assert.ok(
		projected.shapes
			.filter((shape) => shape.kind === "symbol")
			.every(
				(shape) =>
					shape.attributes.reference === "U9" &&
					shape.attributes.value === "Dual updated",
			),
	);
	const extra = applyCircuitCommand(projected.file, {
		type: "connect",
		pinIds: [component.pins[0].id, component.pins[3].id],
	});
	const linked = synchronizePcb(
		extra,
		projected.shapes,
		projected.file,
		symbolDefinitions,
	);
	assert.equal(
		linked.shapes.filter((shape) => shape.kind === "text" && shape.circuitNet)
			.length,
		2,
	);
	assert.deepEqual(
		synchronizePcb(linked.file, linked.shapes, linked.file, symbolDefinitions)
			.file.circuit,
		linked.file.circuit,
	);
	const edited = linked.shapes.map((shape) =>
		shape.kind === "symbol" &&
		shape.id === required(component.schematicShapeIds)[1]
			? { ...shape, attributes: { ...shape.attributes, reference: "U10" } }
			: shape,
	);
	const shared = synchronizePcb(
		linked.file,
		edited,
		linked.file,
		symbolDefinitions,
	);
	assert.equal(shared.file.circuit.components[0].reference, "U10");
	assert.ok(
		shared.shapes
			.filter((shape) => shape.kind === "symbol")
			.every((shape) => shape.attributes.reference === "U10"),
	);
	const remaining = synchronizePcb(
		shared.file,
		shared.shapes.filter((shape) => shape.id !== component.schematicShapeId),
		shared.file,
		symbolDefinitions,
	);
	assert.equal(remaining.file.circuit.components[0].id, component.id);
	assert.deepEqual(
		remaining.file.circuit.components[0].pins.map((pin) => pin.id),
		component.pins.slice(2).map((pin) => pin.id),
	);
	const deleted = applyCircuitCommand(shared.file, {
		type: "remove-component",
		id: component.id,
	});
	assert.equal(
		synchronizePcb(
			deleted,
			shared.shapes,
			shared.file,
			symbolDefinitions,
		).shapes.filter((shape) => shape.kind === "symbol").length,
		0,
	);
	circuitFileSchema.parse(shared.file);
});

test("saved circuits with schematic bindings initialize imported drawings without losing electrical data", () => {
	const original = createCircuit("Import");
	const file = structuredClone(original);
	const a = componentFromSymbol(resistor, []),
		b = componentFromSymbol(resistor, [a]);
	file.circuit.components = [a, b];
	file.circuit.nets = [
		{ id: "signal", names: [], pinIds: [a.pins[0].id, b.pins[1].id] },
	];
	const saved = synchronizePcb(file, [], original, symbolDefinitions);
	const imported = synchronizePcb(saved.file, [], undefined, symbolDefinitions);
	assert.equal(imported.source, "circuit");
	assert.deepEqual(
		imported.file.circuit.components.map((component) => [
			component.id,
			component.pins.map((pin) => pin.id),
		]),
		saved.file.circuit.components.map((component) => [
			component.id,
			component.pins.map((pin) => pin.id),
		]),
	);
	assert.deepEqual(imported.file.circuit.nets, saved.file.circuit.nets);
	assert.equal(
		imported.shapes.filter((shape) => shape.kind === "symbol").length,
		2,
	);
	assert.deepEqual(
		synchronizePcb(
			imported.file,
			imported.shapes,
			imported.file,
			symbolDefinitions,
		).file.circuit,
		imported.file.circuit,
	);
	const schematic = synchronizePcb(
		original,
		[createSymbol(1, resistor, { x: 0, y: 0 }, "R1")],
		undefined,
		symbolDefinitions,
	);
	assert.equal(schematic.file.circuit.components.length, 1);
});

test("blank and whitespace schematic pin numbers normalize while their display overrides remain", () => {
	const original = createCircuit("Blank pins");
	const symbol = createSymbol(1, resistor, { x: 0, y: 0 }, "R1");
	const pin = required(symbol.children.find((child) => child.kind === "pin"));
	const first = synchronizePcb(
		original,
		[{ ...symbol, childOverrides: { [`shape:${pin.id}`]: { number: "7" } } }],
		original,
		symbolDefinitions,
	);
	for (const number of ["", "   "]) {
		const shapes = first.shapes.map((shape) =>
			shape.kind === "symbol"
				? { ...shape, childOverrides: { [`shape:${pin.id}`]: { number } } }
				: shape,
		);
		const next = synchronizePcb(
			first.file,
			shapes,
			first.file,
			symbolDefinitions,
		);
		assert.equal(next.file.circuit.components[0].pins[0].number, "1");
		assert.equal(
			next.file.circuit.components[0].pins[0].id,
			first.file.circuit.components[0].pins[0].id,
		);
		const kept = required(next.shapes.find((shape) => shape.kind === "symbol"));
		assert.ok(kept.kind === "symbol");
		if (kept.kind === "symbol")
			assert.equal(kept.childOverrides?.[`shape:${pin.id}`]?.number, number);
	}
});

test("generated symbols avoid occupied positions after deletion and do not create accidental nets", () => {
	const original = createCircuit("Placement");
	const file = structuredClone(original);
	for (let index = 0; index < 3; index++)
		file.circuit.components.push(
			componentFromSymbol(resistor, file.circuit.components),
		);
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	const deleted = applyCircuitCommand(first.file, {
		type: "remove-component",
		id: first.file.circuit.components[1].id,
	});
	const second = synchronizePcb(
		deleted,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	const added = applyCircuitCommand(second.file, {
		type: "add-component",
		component: componentFromSymbol(resistor, second.file.circuit.components),
	});
	const next = synchronizePcb(
		added,
		second.shapes,
		second.file,
		symbolDefinitions,
	);
	const symbols = next.shapes.filter((shape) => shape.kind === "symbol");
	assert.equal(
		new Set(symbols.map((shape) => `${shape.x},${shape.y}`)).size,
		3,
	);
	assert.deepEqual(
		synchronizePcb(next.file, next.shapes, next.file, symbolDefinitions).file
			.circuit.nets,
		[],
	);
});

test("generated symbols avoid existing wire geometry as well as symbol centers", async () => {
	const { drawShape } = await import("@ecad/drawing-core/drawing/shapes.ts");
	const original = createCircuit("Wire placement");
	const file = structuredClone(original);
	file.circuit.components = [componentFromSymbol(resistor, [])];
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	const wire = drawShape(10, "wire", { x: 57, y: -30 }, { x: 63, y: -30 });
	const added = applyCircuitCommand(first.file, {
		type: "add-component",
		component: componentFromSymbol(resistor, first.file.circuit.components),
	});
	const next = synchronizePcb(
		added,
		[...first.shapes, wire],
		first.file,
		symbolDefinitions,
	);
	assert.ok(
		next.shapes.some(
			(shape) => shape.kind === "symbol" && shape.x === 90 && shape.y === -30,
		),
	);
	assert.deepEqual(
		synchronizePcb(next.file, next.shapes, next.file, symbolDefinitions).file
			.circuit.nets,
		[],
	);
});

test("unavailable-library fallbacks retain inline pins and original part identity across saves", async () => {
	const { persistProjectDrawingShapes, resolveDrawingSymbols } = await import(
		"#/drawing/symbol-persistence.ts"
	);
	const { drawingFileSchema } = await import("#/projects/format.ts");
	const pin = required(resistor.children.find((child) => child.kind === "pin"));
	for (const id of ["unavailable-widget", "resistor"]) {
		const definition = {
			...resistor,
			id,
			name: "Imported custom part",
			library: { scope: "user" as const, id: "missing-library" },
			children: [0, 1, 2].map((index) => ({
				...pin,
				id: index + 1,
				name: `Custom ${index}`,
				number: String(index + 7),
				x: -7,
				y: -index * 3,
			})),
		};
		const file = createCircuit("Inline fallback");
		const component = componentFromSymbol(definition, []);
		file.circuit.components = [{ ...component, schematicShapeId: 91 }];
		file.circuit.nets = [
			{
				id: "signal",
				names: ["SIGNAL"],
				pinIds: [component.pins[0].id, component.pins[1].id],
			},
		];
		let current = synchronizePcb(file, [], undefined, symbolDefinitions);
		const originalPart = structuredClone(component.part);
		for (let pass = 0; pass < 2; pass++) {
			const saved = persistProjectDrawingShapes({
				shapes: current.shapes,
				symbols: [],
			});
			const reopened = drawingFileSchema.parse({
				id: "inline",
				name: "Inline",
				shapes: saved,
			}).shapes;
			const symbol = required(
				reopened.find((shape) => shape.kind === "symbol"),
			);
			assert.ok(symbol.kind === "symbol");
			if (symbol.kind !== "symbol") return;
			assert.equal(
				symbol.children.filter((child) => child.kind === "pin").length,
				3,
			);
			assert.equal(symbol.library, undefined);
			const resolved = resolveDrawingSymbols(
				reopened,
				symbolDefinitions,
				new Map(),
			);
			assert.deepEqual(resolved.errors, []);
			current = synchronizePcb(
				current.file,
				resolved.shapes,
				current.file,
				symbolDefinitions,
			);
			assert.deepEqual(current.file.circuit.components[0].part, originalPart);
			assert.equal(current.file.circuit.components[0].id, component.id);
			assert.deepEqual(
				current.file.circuit.components[0].pins.map((pin) => pin.id),
				component.pins.map((pin) => pin.id),
			);
			assert.deepEqual(current.file.circuit.nets, file.circuit.nets);
		}
	}
});

test("unannotated KiCad parts stay independent and receive unused references", async () => {
	const { importKiCadSchematic } = await import("#/formats/kicad/import.ts");
	const source = `(kicad_sch (version 20250114) (paper "A4")
 (lib_symbols (symbol "Part" (symbol "Part_1_1" (pin passive line (at -3 0 0) (length 2) (name "P") (number "1")))))
 (symbol (lib_id "Part") (at 10 20 0) (unit 1) (uuid "a") (property "Reference" "R?" (at 10 20 0)) (property "Value" "10k" (at 10 21 0)))
 (symbol (lib_id "Part") (at 30 20 0) (unit 1) (uuid "b") (property "Reference" "R?" (at 30 20 0)) (property "Value" "22k" (at 30 21 0)))
 (symbol (lib_id "Part") (at 50 20 0) (unit 1) (uuid "c") (property "Reference" "R1" (at 50 20 0)) (property "Value" "47k" (at 50 21 0))))`;
	const imported = importKiCadSchematic(source);
	const original = createCircuit("Unannotated");
	const first = synchronizePcb(
		original,
		imported.shapes,
		original,
		symbolDefinitions,
	);
	assert.equal(first.file.circuit.components.length, 3);
	assert.deepEqual(
		first.file.circuit.components.map((component) => component.value),
		["10k", "22k", "47k"],
	);
	assert.deepEqual(
		first.file.circuit.components.map((component) => component.reference),
		["R2", "R3", "R1"],
	);
	assert.equal(
		new Set(first.file.circuit.components.map((component) => component.id))
			.size,
		3,
	);
	const next = synchronizePcb(
		first.file,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	assert.deepEqual(next.file.circuit, first.file.circuit);
	assert.deepEqual(
		next.shapes
			.filter((shape) => shape.kind === "symbol")
			.map((shape) => shape.attributes.reference),
		["R2", "R3", "R1"],
	);
	const duplicate = source.replace('"R?"', '"R1"').replace('"R?"', '"R1"');
	assert.throws(
		() =>
			synchronizePcb(
				original,
				importKiCadSchematic(duplicate).shapes,
				original,
				symbolDefinitions,
			),
		/Duplicate component reference/,
	);
});

test("reusable definition pin edits and cleared overrides update metadata and generated captions", () => {
	const definition = {
		...resistor,
		library: { scope: "project" as const, id: "project-symbols" },
	};
	const original = createCircuit("Pin metadata");
	const symbol = createSymbol(1, definition, { x: 0, y: 0 }, "R1");
	const initial = synchronizePcb(original, [symbol], original, [definition]);
	const file = structuredClone(initial.file);
	const pinId = file.circuit.components[0].pins[0].id;
	file.circuit.nets = [{ id: "signal", names: [], pinIds: [pinId] }];
	const first = synchronizePcb(file, initial.shapes, initial.file, [
		definition,
	]);
	const sourceId = required(
		first.file.circuit.components[0].pins[0].sourcePinId,
	);
	const updated = {
		...definition,
		children: definition.children.map((child) =>
			child.kind === "pin" && String(child.id) === sourceId
				? { ...child, name: "RENAMED", number: "42" }
				: child,
		),
	};
	const shapes = first.shapes.map((shape) =>
		shape.kind === "symbol" ? { ...shape, children: updated.children } : shape,
	);
	const next = synchronizePcb(first.file, shapes, first.file, [updated]);
	assert.equal(next.file.circuit.components[0].pins[0].id, pinId);
	assert.equal(next.file.circuit.components[0].pins[0].name, "RENAMED");
	assert.equal(next.file.circuit.components[0].pins[0].number, "42");
	assert.ok(
		next.shapes.some(
			(shape) => shape.kind === "text" && shape.text === "RENAMED",
		),
	);
	assert.deepEqual(next.file.circuit.nets, file.circuit.nets);
	const overridden = next.shapes.map((shape) =>
		shape.kind === "symbol"
			? {
					...shape,
					childOverrides: {
						[`shape:${sourceId}`]: { name: "INSTANCE", number: "99" },
					},
				}
			: shape,
	);
	const withOverride = synchronizePcb(next.file, overridden, next.file, [
		updated,
	]);
	assert.equal(withOverride.file.circuit.components[0].pins[0].number, "99");
	const cleared = withOverride.shapes.map((shape) =>
		shape.kind === "symbol" ? { ...shape, childOverrides: undefined } : shape,
	);
	const restored = synchronizePcb(
		withOverride.file,
		cleared,
		withOverride.file,
		[updated],
	);
	assert.equal(restored.file.circuit.components[0].pins[0].name, "RENAMED");
	assert.equal(restored.file.circuit.components[0].pins[0].number, "42");
	assert.ok(
		restored.shapes.some(
			(shape) => shape.kind === "text" && shape.text === "RENAMED",
		),
	);
	const unnamed = restored.shapes.map((shape) =>
		shape.kind === "symbol"
			? {
					...shape,
					children: shape.children.map((child) =>
						child.kind === "pin" && String(child.id) === sourceId
							? { ...child, name: "" }
							: child,
					),
				}
			: shape,
	);
	const numbered = synchronizePcb(restored.file, unnamed, restored.file, [
		updated,
	]);
	assert.ok(
		numbered.shapes.some(
			(shape) => shape.kind === "text" && shape.text === "R1.42",
		),
	);
});

test("legacy shared pin names bind exact numbers to distinct symbol terminals", () => {
	const child = required(
		resistor.children.find((child) => child.kind === "pin"),
	);
	const definition = {
		...resistor,
		id: "shared-ground",
		children: [
			{ ...child, id: 1, name: "GND", number: "1", x: -3, y: 0 },
			{ ...child, id: 2, name: "GND", number: "2", x: 3, y: 0 },
		],
	};
	const file = createCircuit("Ground pins");
	const component = componentFromSymbol(definition, []);
	component.pins = component.pins.map(
		({ sourcePinId: _source, ...pin }) => pin,
	);
	file.circuit.components = [component];
	file.circuit.nets = component.pins.map((pin, index) => ({
		id: `ground-${index}`,
		names: [`GND_${index}`],
		pinIds: [pin.id],
	}));
	const first = synchronizePcb(file, [], undefined, [definition]);
	assert.deepEqual(
		first.file.circuit.components[0].pins.map((pin) => pin.sourcePinId),
		["1", "2"],
	);
	const labels = first.shapes.filter((shape) => shape.kind === "text");
	assert.equal(new Set(labels.map((shape) => `${shape.x},${shape.y}`)).size, 2);
	assert.deepEqual(
		synchronizePcb(first.file, first.shapes, first.file, [definition]).file
			.circuit.nets,
		file.circuit.nets,
	);
});

test("net labels attach to the source pin when an earlier pin repeats its number", () => {
	const child = required(
		resistor.children.find((child) => child.kind === "pin"),
	);
	const definition = {
		...resistor,
		id: "repeated-number",
		children: [
			{ ...child, id: 1, name: "A", number: "1", x: 0, y: 0 },
			{ ...child, id: 2, name: "B", number: "1", x: 0, y: -10 },
		],
	};
	const symbol = createSymbol(1, definition, { x: 0, y: 0 }, "U1");
	const component = componentFromSymbol(definition, []);
	component.schematicShapeId = symbol.id;
	const target = component.pins[1];
	assert.equal(target.sourcePinId, "2");
	const file = createCircuit("Repeated numbers");
	file.circuit.components = [component];
	file.circuit.nets = [{ id: "net", names: ["N1"], pinIds: [target.id] }];
	const { shapes } = synchronizePcb(file, [symbol], undefined, [definition]);
	const label = required(shapes.find((shape) => shape.kind === "text"));
	assert.equal(label.circuitNet?.pinId, target.id);
	assert.deepEqual({ x: label.x, y: label.y }, { x: 0, y: -10 });
});

test("rotating generated components preserves attached and independently moved labels", async () => {
	const { Effect } = await import("effect");
	const { createDrawingStore, DrawingStore } = await import(
		"@ecad/drawing-core/commands/drawing-store.ts"
	);
	const { placeShapesEffect, rotateShapesEffect, undoEffect, redoEffect } =
		await import("@ecad/drawing-core/commands/drawing-commands.ts");
	const { moveShapes } = await import("@ecad/drawing-core/drawing/shapes.ts");
	const original = createCircuit("Rotate labels");
	const file = structuredClone(original);
	const a = componentFromSymbol(resistor, []),
		b = componentFromSymbol(resistor, [a]);
	file.circuit.components = [a, b];
	file.circuit.nets = [
		{ id: "signal", names: [], pinIds: [a.pins[1].id, b.pins[0].id] },
		{ id: "power", names: ["VDD"], pinIds: [a.pins[0].id] },
	];
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	for (const selectLabels of [false, true])
		for (const movedLabel of [false, true])
			for (const angle of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
				let shapes = first.shapes;
				const label = required(
					shapes.find(
						(shape) =>
							shape.kind === "text" && shape.circuitNet?.pinId === a.pins[1].id,
					),
				);
				if (movedLabel) {
					const replacements = moveShapes(
						[label],
						{ x: 15, y: -15 },
						0,
						label,
						shapes,
					);
					const byId = new Map(replacements.map((shape) => [shape.id, shape]));
					shapes = [
						...shapes.map((shape) => byId.get(shape.id) ?? shape),
						...replacements.filter(
							(shape) => !shapes.some((old) => old.id === shape.id),
						),
					];
				}
				const linked = synchronizePcb(
					first.file,
					shapes,
					first.file,
					symbolDefinitions,
				);
				const store = createDrawingStore();
				const run = <A, E>(
					effect: import("effect").Effect.Effect<
						A,
						E,
						import("@ecad/drawing-core/commands/drawing-store.ts").DrawingStore
					>,
				) =>
					Effect.runSync(
						effect.pipe(Effect.provideService(DrawingStore, store)),
					);
				run(placeShapesEffect(linked.shapes, "Generated schematic"));
				const before = store.getSnapshot().shapes;
				const ids = [
					required(first.file.circuit.components[0].schematicShapeId),
					...(selectLabels
						? before
								.filter((shape) => shape.kind === "text")
								.map((shape) => shape.id)
						: []),
				];
				run(rotateShapesEffect(ids, angle));
				const rotated = store.getSnapshot().shapes;
				assert.equal(
					rotated.find(
						(shape) =>
							shape.id === first.file.circuit.components[0].schematicShapeId,
					)?.rotation,
					((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
				);
				const next = synchronizePcb(
					linked.file,
					rotated,
					linked.file,
					symbolDefinitions,
				);
				assert.deepEqual(next.file.circuit.nets, first.file.circuit.nets);
				if (movedLabel) {
					const actual = required(
						next.shapes.find((shape) => shape.id === label.id),
					);
					const expected = required(
						linked.shapes.find((shape) => shape.id === label.id),
					);
					assert.deepEqual(
						{ x: actual.x, y: actual.y },
						{ x: expected.x, y: expected.y },
					);
				}
				assert.deepEqual(
					synchronizePcb(next.file, next.shapes, next.file, symbolDefinitions)
						.file.circuit.nets,
					first.file.circuit.nets,
				);
				run(undoEffect);
				assert.deepEqual(store.getSnapshot().shapes, before);
				run(redoEffect);
				assert.deepEqual(store.getSnapshot().shapes, rotated);
			}
});

test("net symbols name circuit nets without becoming referenced components", () => {
	const file = createCircuit("Board");
	const supply = createSymbol(
		1,
		required(symbolDefinitions.find((definition) => definition.id === "vdd")),
		{ x: 0, y: 0 },
	);
	const first = synchronizePcb(file, [supply], file, symbolDefinitions);
	assert.equal(first.file.circuit.components.length, 0);
	assert.deepEqual(
		first.file.circuit.nets.map((net) => net.names),
		[["VDD"]],
	);
	const shape = first.shapes.find((shape) => shape.kind === "symbol");
	assert.ok(shape?.kind === "symbol");
	assert.equal(shape.attributes.reference, "");
	const second = synchronizePcb(
		first.file,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	assert.equal(second.file.circuit.components.length, 0);
	assert.deepEqual(second.file.circuit.nets, first.file.circuit.nets);
	assert.ok(
		second.shapes.some(
			(shape) => shape.kind === "symbol" && shape.attributes.reference === "",
		),
	);
});

test("circuit renames and deletions update net-symbol declarations without resurrection", () => {
	for (const connected of [false, true])
		for (const edit of ["rename", "anonymous", "delete"] as const) {
			const original = createCircuit("Board");
			const supply = createSymbol(
				1,
				required(
					symbolDefinitions.find((definition) => definition.id === "vdd"),
				),
				{ x: 0, y: 0 },
			);
			const shapes = connected
				? [
						supply,
						createSymbol(2, resistor, { x: 3, y: 0 }),
						createSymbol(
							3,
							required(
								symbolDefinitions.find((definition) => definition.id === "vdd"),
							),
							{ x: 30, y: 0 },
						),
						createSymbol(4, resistor, { x: 33, y: 0 }),
					]
				: [supply];
			const first = synchronizePcb(
				original,
				shapes,
				original,
				symbolDefinitions,
			);
			const net = required(
				first.file.circuit.nets.find((net) => net.names.includes("VDD")),
			);
			const edited = applyCircuitCommand(
				first.file,
				edit === "delete"
					? { type: "remove-net", id: net.id }
					: {
							type: "rename-net",
							id: net.id,
							names: edit === "rename" ? ["RAIL"] : [],
						},
			);
			const second = synchronizePcb(
				edited,
				first.shapes,
				first.file,
				symbolDefinitions,
			);
			const symbol = second.shapes.find((shape) => shape.kind === "symbol");
			assert.ok(symbol?.kind === "symbol");
			assert.equal(symbol.attributes.name, edit === "rename" ? "RAIL" : "");
			const third = synchronizePcb(
				second.file,
				second.shapes,
				second.file,
				symbolDefinitions,
			);
			assert.deepEqual(third.file.circuit.nets, second.file.circuit.nets);
			assert.ok(
				!third.file.circuit.nets.some((net) => net.names.includes("VDD")),
			);
		}
});

test("circuit membership removals survive direct and rotated net-symbol contacts", async () => {
	const { pinTerminals, drawShape } = await import(
		"@ecad/drawing-core/drawing/shapes.ts"
	);
	for (const contact of ["direct", "rotated", "wire", "multi"] as const)
		for (const operation of [
			"disconnect",
			"no-connect",
			"split-net",
		] as const) {
			const original = createCircuit("Board");
			const definition = required(
				symbolDefinitions.find(
					(definition) =>
						definition.id === (contact === "rotated" ? "ground" : "vdd"),
				),
			);
			const supply = createSymbol(1, definition, { x: 0, y: 0 });
			supply.attributes.name = "VDD";
			if (contact === "rotated") supply.rotation = Math.PI / 2;
			if (contact === "multi")
				supply.children.push(
					drawShape(99, "pin", { x: 40, y: 0 }, { x: 40, y: 0 }),
				);
			const terminal = pinTerminals(supply)[0];
			const component = createSymbol(
				2,
				resistor,
				contact === "wire"
					? { x: terminal.x - 10, y: terminal.y }
					: { x: terminal.x + 3.81, y: terminal.y },
			);
			const remote = createSymbol(
				3,
				required(
					symbolDefinitions.find((definition) => definition.id === "vdd"),
				),
				{ x: 40, y: 0 },
			);
			const shapes = [
				supply,
				component,
				remote,
				createSymbol(4, resistor, { x: 43.81, y: 0 }),
				...(contact === "wire"
					? [drawShape(5, "wire", pinTerminals(component)[1], terminal)]
					: []),
			];
			const first = synchronizePcb(
				original,
				shapes,
				original,
				symbolDefinitions,
			);
			const net = required(
				first.file.circuit.nets.find((net) => net.names.includes("VDD")),
			);
			const owner = required(
				first.file.circuit.components.find(
					(component) => component.schematicShapeId === 2,
				),
			);
			const pin = required(
				owner.pins.find((pin) => net.pinIds.includes(pin.id)),
			);
			assert.ok(pin);
			const edited = applyCircuitCommand(
				first.file,
				operation === "no-connect"
					? { type: "no-connect", pinId: pin.id, enabled: true }
					: operation === "split-net"
						? { type: "split-net", netId: net.id, pinIds: [pin.id] }
						: { type: "disconnect", pinIds: [pin.id] },
			);
			const second = synchronizePcb(
				edited,
				first.shapes,
				first.file,
				symbolDefinitions,
			);
			const third = synchronizePcb(
				second.file,
				second.shapes,
				second.file,
				symbolDefinitions,
			);
			assert.deepEqual(
				third.file.circuit.nets,
				second.file.circuit.nets,
				`${contact}/${operation}`,
			);
			assert.deepEqual(
				third.file.circuit.noConnectPinIds,
				second.file.circuit.noConnectPinIds,
			);
			assert.ok(
				!required(
					third.file.circuit.nets.find((net) => net.names.includes("VDD")),
				).pinIds.includes(pin.id),
			);
			const retained = third.shapes.find((shape) => shape.id === 3);
			assert.ok(retained?.kind === "symbol");
			assert.equal(retained.attributes.name, "VDD");
		}
});

test("matching net symbols share a circuit net through renames and repeated synchronization", () => {
	const original = createCircuit("Rails");
	const definition = required(
		symbolDefinitions.find((definition) => definition.id === "vdd"),
	);
	const firstSymbol = createSymbol(1, definition, { x: 0, y: 0 });
	const secondSymbol = createSymbol(2, definition, { x: 40, y: 0 });
	const first = synchronizePcb(
		original,
		[firstSymbol, secondSymbol],
		original,
		symbolDefinitions,
	);
	assert.equal(first.file.circuit.nets.length, 1);
	const separated = synchronizePcb(
		first.file,
		first.shapes.map((shape) =>
			shape.id === 2 && shape.kind === "symbol"
				? { ...shape, attributes: { ...shape.attributes, name: "OTHER" } }
				: shape,
		),
		first.file,
		symbolDefinitions,
	);
	assert.equal(separated.file.circuit.nets.length, 2);
	const other = required(
		separated.file.circuit.nets.find((net) => net.names.includes("OTHER")),
	);
	const edited = applyCircuitCommand(separated.file, {
		type: "rename-net",
		id: other.id,
		names: ["VDD"],
	});
	const merged = synchronizePcb(
		edited,
		separated.shapes,
		separated.file,
		symbolDefinitions,
	);
	assert.equal(merged.file.circuit.nets.length, 1);
	assert.deepEqual(
		merged.shapes
			.filter((shape) => shape.kind === "symbol")
			.map((shape) => shape.attributes.name),
		["VDD", "VDD"],
	);
	assert.deepEqual(
		synchronizePcb(merged.file, merged.shapes, merged.file, symbolDefinitions)
			.file.circuit.nets,
		merged.file.circuit.nets,
	);
});

test("undo and redo of a net-name merge restore every symbol declaration and membership", async () => {
	const { createCircuitStore } = await import(
		"@ecad/drawing-core/circuit/store.ts"
	);
	const { pinTerminals } = await import("@ecad/drawing-core/drawing/shapes.ts");
	const { drawingFileSchema } = await import("#/projects/format.ts");
	for (const connected of [0, 1, 2]) {
		const original = createCircuit("Undo rails");
		const definition = required(
			symbolDefinitions.find((definition) => definition.id === "vdd"),
		);
		const symbols = [
			createSymbol(1, definition, { x: 0, y: 0 }),
			createSymbol(2, definition, { x: 40, y: 0 }),
		];
		symbols[1].attributes.name = "OTHER";
		const parts = symbols.slice(0, connected).map((symbol, index) => {
			const part = createSymbol(
				index + 3,
				resistor,
				{ x: 0, y: 0 },
				`R${index + 1}`,
			);
			const target = pinTerminals(symbol)[0],
				terminal = required(pinTerminals(part).at(-1));
			return { ...part, x: target.x - terminal.x, y: target.y - terminal.y };
		});
		const first = synchronizePcb(
			original,
			[...symbols, ...parts],
			original,
			symbolDefinitions,
		);
		const store = createCircuitStore(first.file);
		const other = required(
			first.file.circuit.nets.find((net) => net.names.includes("OTHER")),
		);
		store.execute({ type: "rename-net", id: other.id, names: ["VDD"] });
		const merged = synchronizePcb(
			store.getSnapshot(),
			first.shapes,
			first.file,
			symbolDefinitions,
		);
		store.synchronize(merged.file, { preserveHistory: true });
		const saved = drawingFileSchema.parse(
			JSON.parse(
				JSON.stringify({ id: "undo", name: "Undo", shapes: merged.shapes }),
			),
		).shapes;
		store.undo();
		const restored = synchronizePcb(
			store.getSnapshot(),
			saved,
			merged.file,
			symbolDefinitions,
		);
		assert.deepEqual(
			restored.shapes.flatMap((shape) =>
				shape.kind === "symbol" && shape.netSymbol
					? [shape.attributes.name]
					: [],
			),
			["VDD", "OTHER"],
			`connected=${connected}`,
		);
		assert.deepEqual(restored.file.circuit.nets, first.file.circuit.nets);
		assert.deepEqual(
			synchronizePcb(
				restored.file,
				restored.shapes,
				restored.file,
				symbolDefinitions,
			).file.circuit.nets,
			restored.file.circuit.nets,
		);
		store.synchronize(restored.file, { preserveHistory: true });
		store.redo();
		const redone = synchronizePcb(
			store.getSnapshot(),
			restored.shapes,
			restored.file,
			symbolDefinitions,
		);
		assert.deepEqual(
			redone.shapes.flatMap((shape) =>
				shape.kind === "symbol" && shape.netSymbol
					? [shape.attributes.name]
					: [],
			),
			["VDD", "VDD"],
		);
		assert.deepEqual(redone.file.circuit.nets, merged.file.circuit.nets);
	}
});
