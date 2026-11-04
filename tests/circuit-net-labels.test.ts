import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCircuitGraph } from "@ecad/drawing-core/circuit/graph.ts";
import {
	createCircuit,
	parseCircuit,
	serializeCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import { circuitNetLabels } from "@ecad/drawing-core/circuit/net-labels.ts";
import { instantiateCircuitPart } from "@ecad/drawing-core/circuit/parts.ts";
import { createCircuitStore } from "@ecad/drawing-core/circuit/store.ts";
import { required } from "./helpers/required.ts";

function fixture() {
	const file = createCircuit("Names");
	for (const names of [
		["GND", "XOUT", "", "4"],
		["GND", "XIN", "~", "4"],
	])
		file.circuit.components.push(
			instantiateCircuitPart(
				{
					id: "device",
					name: "Device",
					prefix: "U",
					value: "",
					pins: names.map((name, index) => ({
						name,
						number: String(index + 1),
					})),
				},
				file.circuit.components,
			),
		);
	const [a, b] = file.circuit.components;
	file.circuit.nets.push(
		{ id: "ground", names: [], pinIds: [a.pins[0].id, b.pins[0].id] },
		{ id: "clock", names: [], pinIds: [a.pins[1].id, b.pins[1].id] },
		{ id: "generic", names: [], pinIds: [a.pins[2].id, b.pins[3].id] },
	);
	return file;
}

test("automatic net labels use distinct pin names and qualify unnamed or numeric pins", () => {
	const file = fixture();
	const before = structuredClone(file);
	assert.deepEqual(Object.fromEntries(circuitNetLabels(file.circuit)), {
		clock: "XIN / XOUT",
		generic: "U1.3 / U2.4",
		ground: "GND",
	});
	assert.deepEqual(file, before);
	file.circuit.nets[1].pinIds.push(file.circuit.components[1].pins[2].id);
	assert.equal(circuitNetLabels(file.circuit).get("clock"), "XIN / XOUT");
	assert.deepEqual(
		buildCircuitGraph(file).nets.map((net) => net.label),
		["GND", "XIN / XOUT", "U1.3 / U2.4"],
	);
});

test("automatic labels avoid manual names, aliases, and each other without merging nets", () => {
	const file = fixture();
	file.circuit.nets.push({ id: "named", names: ["GROUND", "GND"], pinIds: [] });
	file.circuit.nets[1].pinIds.forEach((id) => {
		required(
			file.circuit.components
				.flatMap((component) => component.pins)
				.find((pin) => pin.id === id),
		).name = "GND";
	});
	const labels = circuitNetLabels(file.circuit);
	assert.equal(labels.get("clock"), "GND_2");
	assert.equal(labels.get("ground"), "GND_3");
	const reversed = structuredClone(file.circuit);
	reversed.nets.reverse();
	reversed.nets.forEach((net) => {
		net.pinIds.reverse();
	});
	reversed.components.reverse();
	assert.deepEqual(circuitNetLabels(reversed), labels);
	assert.equal(file.circuit.nets.length, 4);
	assert.deepEqual(file.circuit.nets[0].names, []);
});

test("automatic labels follow edits, splits, reloads, and undo while manual names stay fixed", () => {
	const file = fixture();
	const store = createCircuitStore(file);
	const label = (id: string) =>
		circuitNetLabels(store.getSnapshot().circuit).get(id);
	store.execute({
		type: "disconnect",
		pinIds: [file.circuit.components[0].pins[1].id],
	});
	assert.equal(label("clock"), "XIN");
	store.undo();
	assert.equal(label("clock"), "XIN / XOUT");
	store.execute({ type: "rename-net", id: "clock", names: ["CLOCK"] });
	store.execute({
		type: "disconnect",
		pinIds: [file.circuit.components[0].pins[1].id],
	});
	assert.equal(label("clock"), "CLOCK");
	store.execute({ type: "rename-net", id: "clock", names: [] });
	assert.equal(label("clock"), "XIN");
	store.execute({
		type: "split-net",
		netId: "generic",
		pinIds: [file.circuit.components[0].pins[2].id],
	});
	assert.equal(label("generic"), "U2.4");
	store.execute({
		type: "update-component",
		id: file.circuit.components[1].id,
		reference: "U7",
		value: "",
	});
	assert.equal(label("generic"), "U7.4");
	const saved = parseCircuit(serializeCircuit(store.getSnapshot().circuit));
	assert.deepEqual(
		circuitNetLabels(saved),
		circuitNetLabels(store.getSnapshot().circuit),
	);
	assert.deepEqual(saved.nets.find((net) => net.id === "clock")?.names, []);
});

test("large automatic labels remain bounded and empty nets still have a label", () => {
	const file = fixture();
	file.circuit.nets = [
		{
			id: "bus",
			names: [],
			pinIds: file.circuit.components.flatMap((component) =>
				component.pins.map((pin) => pin.id),
			),
		},
		{ id: "empty", names: [], pinIds: [] },
	];
	assert.equal(circuitNetLabels(file.circuit).get("bus"), "GND / XIN / XOUT");
	for (const component of file.circuit.components)
		for (const pin of component.pins) pin.name = pin.id.repeat(8);
	const labels = circuitNetLabels(file.circuit);
	assert.ok(required(labels.get("bus")).length <= 180);
	assert.equal(labels.get("empty"), "Net 2");
});
