import assert from "node:assert/strict";
import { test } from "node:test";
import {
	circuitFileSchema,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import { applyCircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
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
test("a circuit added with a drawing that already describes it keeps the drawing's wires", () => {
	const first = createSymbol(1, resistor, { x: 0, y: 0 }, "R1");
	const second = createSymbol(2, resistor, { x: 20, y: 0 }, "R2");
	const terminal = (symbol: typeof first) => {
		const pin = required(symbol.children.find((child) => child.kind === "pin"));
		return { x: symbol.x + pin.x, y: symbol.y + pin.y };
	};
	const from = terminal(first);
	const to = terminal(second);
	const wire: EditorShape = {
		id: 3,
		kind: "wire",
		x: (from.x + to.x) / 2,
		y: (from.y + to.y) / 2,
		width: Math.hypot(to.x - from.x, to.y - from.y),
		height: 0.2,
		rotation: Math.atan2(to.y - from.y, to.x - from.x),
		lineWidth: 0.2,
	};
	const empty = createCircuit("Board");
	const drawn = synchronizePcb(
		empty,
		[first, second, wire],
		empty,
		symbolDefinitions,
	);
	assert.equal(drawn.file.circuit.nets.length, 1);
	const added = synchronizePcb(
		drawn.file,
		drawn.shapes,
		undefined,
		symbolDefinitions,
	);
	assert.equal(added.source, "schematic");
	assert.deepEqual(added.shapes, drawn.shapes);
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
	assert.deepEqual(
		paired.circuits?.map((file) => file.circuit.id),
		["pcb-board"],
	);
	assert.deepEqual(pairPcbDocuments(paired, "Project"), paired);
	assert.equal("circuitId" in input.drawings[0], false);
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

test("schematic no-connect markers set and clear circuit no-connect pins", async () => {
	const { drawShape, pinTerminals } = await import(
		"@ecad/drawing-core/drawing/shapes.ts"
	);
	const original = createCircuit("Board");
	const symbol = createSymbol(1, resistor, { x: 0, y: 0 }, "R1");
	const [terminal, other] = pinTerminals(symbol);
	const stubEnd = { x: other.x + 5.08, y: other.y };
	const marked = synchronizePcb(
		original,
		[
			symbol,
			drawShape(2, "no-connect", terminal, terminal),
			drawShape(3, "wire", other, stubEnd),
			drawShape(4, "no-connect", stubEnd, stubEnd),
		],
		original,
		symbolDefinitions,
	);
	const [first, second] = marked.file.circuit.components[0].pins;
	assert.deepEqual(marked.file.circuit.noConnectPinIds, [first.id, second.id]);
	const cleared = synchronizePcb(
		marked.file,
		marked.shapes.filter((shape) => shape.id !== 2 && shape.id !== 4),
		marked.file,
		symbolDefinitions,
	);
	assert.deepEqual(cleared.file.circuit.noConnectPinIds, []);
	assert.equal(cleared.file.circuit.revision, marked.file.circuit.revision + 1);
});

test("circuit no-connect pins place and remove schematic markers", async () => {
	const { drawShape, pinTerminals } = await import(
		"@ecad/drawing-core/drawing/shapes.ts"
	);
	const original = createCircuit("Board");
	const r1 = { ...createSymbol(1, resistor, { x: 0, y: 0 }, "R1"), page: 2 };
	const r2 = createSymbol(2, resistor, { x: 20, y: 0 }, "R2");
	const [terminal, other] = pinTerminals(r1);
	const stubEnd = { x: other.x + 5.08, y: other.y };
	const first = synchronizePcb(
		original,
		[
			r1,
			r2,
			{ ...drawShape(3, "wire", other, stubEnd), page: 2 },
			{ ...drawShape(4, "no-connect", stubEnd, stubEnd), page: 2 },
		],
		original,
		symbolDefinitions,
	);
	const [pin, stubbed] = first.file.circuit.components[0].pins;
	assert.deepEqual(first.file.circuit.noConnectPinIds, [stubbed.id]);
	const declared = synchronizePcb(
		applyCircuitCommand(first.file, {
			type: "no-connect",
			pinId: pin.id,
			enabled: true,
		}),
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	const markers = declared.shapes.filter(
		(shape) => shape.kind === "no-connect",
	);
	assert.equal(markers.length, 2);
	const placed = required(markers.find((shape) => shape.id !== 4));
	assert.equal(placed.page, 2);
	assert.ok(Math.hypot(placed.x - terminal.x, placed.y - terminal.y) < 1e-9);
	const unchanged = synchronizePcb(
		declared.file,
		declared.shapes,
		declared.file,
		symbolDefinitions,
	);
	assert.deepEqual(
		unchanged.file.circuit.noConnectPinIds,
		declared.file.circuit.noConnectPinIds,
	);
	assert.equal(unchanged.file.circuit.revision, declared.file.circuit.revision);
	const connected = synchronizePcb(
		applyCircuitCommand(
			applyCircuitCommand(declared.file, {
				type: "no-connect",
				pinId: stubbed.id,
				enabled: false,
			}),
			{
				type: "connect",
				pinIds: [pin.id, first.file.circuit.components[1].pins[0].id],
			},
		),
		declared.shapes,
		declared.file,
		symbolDefinitions,
	);
	assert.deepEqual(
		connected.shapes.filter((shape) => shape.kind === "no-connect"),
		[],
	);
	assert.ok(connected.shapes.some((shape) => shape.id === 3));
	const roundtrip = synchronizePcb(
		connected.file,
		connected.shapes,
		connected.file,
		symbolDefinitions,
	);
	assert.deepEqual(roundtrip.file.circuit.noConnectPinIds, []);
	assert.deepEqual(roundtrip.file.circuit.nets, connected.file.circuit.nets);
});
