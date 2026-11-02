import assert from "node:assert/strict";
import { test } from "node:test";
import {
	circuitFileSchema,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { electricalNets } from "#/drawing/named-nets.ts";
import {
	type EditorShape,
	type EditorSymbol,
	symbolShapes,
	type TextShape,
} from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import type { Point } from "#/drawing/types.ts";

const connector = symbolDefinitions.find(
	(definition) => definition.id === "connector-3",
)!;
const firstPin = (symbol: EditorSymbol) =>
	symbolShapes(symbol).find((shape) => shape.kind === "pin")!;
const label = (id: number, text: string, point: Point): TextShape => ({
	id,
	kind: "text",
	electrical: "net",
	x: point.x,
	y: point.y,
	width: 2,
	height: 1,
	rotation: 0,
	lineWidth: 0.127,
	fontSize: 1,
	text,
	horizontalAlign: "left",
	verticalAlign: "bottom",
});

for (const removedName of ["DEBUG_DATA", "SWDIO"]) {
	test(`deleting the explicit ${removedName} alias removes it from the saved circuit`, () => {
		const original = createCircuit("Aliases");
		const symbol = createSymbol(1, connector, { x: 0, y: 0 }, "J1");
		const shapes = [
			symbol,
			label(2, "DEBUG_DATA", firstPin(symbol)),
			label(3, "SWDIO", firstPin(symbol)),
		];
		const first = synchronizePcb(original, shapes, original, symbolDefinitions);
		assert.deepEqual(first.file.circuit.nets[0].names, ["DEBUG_DATA", "SWDIO"]);
		const edited = shapes.filter(
			(shape) => shape.kind !== "text" || shape.text !== removedName,
		);
		const saved = synchronizePcb(
			first.file,
			edited,
			first.file,
			symbolDefinitions,
		);
		assert.deepEqual(saved.file.circuit.nets[0].names, [
			removedName === "SWDIO" ? "DEBUG_DATA" : "SWDIO",
		]);
		assert.equal(saved.file.circuit.nets[0].id, first.file.circuit.nets[0].id);
		const reopened = circuitFileSchema.parse(
			JSON.parse(JSON.stringify(saved.file)),
		);
		assert.deepEqual(
			synchronizePcb(reopened, saved.shapes, reopened, symbolDefinitions).file
				.circuit,
			saved.file.circuit,
		);
	});
}

for (const saveBetweenEdits of [false, true]) {
	test(`moving an explicit alias to a recreated connector stays separate with intermediate save ${saveBetweenEdits}`, () => {
		const original = createCircuit("SWD");
		const a = createSymbol(1, connector, { x: 0, y: 0 }, "J1");
		const b = createSymbol(2, connector, { x: 40, y: 0 }, "J2");
		const primary = label(3, "DEBUG_DATA", firstPin(a));
		const first = synchronizePcb(
			original,
			[a, b, primary, label(4, "SWDIO", firstPin(a))],
			original,
			symbolDefinitions,
		);
		const base = saveBetweenEdits
			? synchronizePcb(first.file, [a, primary], first.file, symbolDefinitions)
					.file
			: first.file;
		const replacement = createSymbol(5, connector, { x: 40, y: 0 }, "J2");
		const edited = [
			a,
			replacement,
			primary,
			label(6, "SWDIO", firstPin(replacement)),
		];
		assert.deepEqual(
			electricalNets(edited)
				.filter((net) => net.names.length)
				.map((net) => net.names),
			[["DEBUG_DATA"], ["SWDIO"]],
		);
		const saved = synchronizePcb(base, edited, base, symbolDefinitions);
		assert.deepEqual(
			saved.file.circuit.nets.map((net) => net.names),
			[["DEBUG_DATA"], ["SWDIO"]],
		);
		assert.equal(saved.file.circuit.components.length, 2);
		for (const net of saved.file.circuit.nets) {
			const owner = saved.file.circuit.components.find(
				(component) =>
					component.reference === (net.names[0] === "SWDIO" ? "J2" : "J1"),
			)!;
			assert.deepEqual(net.pinIds, [owner.pins[0].id]);
		}
		const reopened = circuitFileSchema.parse(
			JSON.parse(JSON.stringify(saved.file)),
		);
		assert.deepEqual(
			synchronizePcb(reopened, saved.shapes, reopened, symbolDefinitions).file
				.circuit,
			saved.file.circuit,
		);
	});
}

test("generated captions preserve circuit aliases across repeated saves", () => {
	const original = createCircuit("Generated aliases");
	const file = structuredClone(original);
	const component = componentFromSymbol(connector, []);
	file.circuit.components = [component];
	file.circuit.nets = [
		{
			id: "debug",
			names: ["DEBUG_DATA", "SWDIO"],
			pinIds: [component.pins[0].id],
		},
	];
	const first = synchronizePcb(file, [], original, symbolDefinitions);
	assert.deepEqual(
		first.shapes
			.filter((shape) => shape.kind === "text")
			.map((shape) => shape.text),
		["DEBUG_DATA"],
	);
	const saved = synchronizePcb(
		first.file,
		first.shapes,
		first.file,
		symbolDefinitions,
	);
	assert.deepEqual(saved.file.circuit.nets, first.file.circuit.nets);
	const reopened = circuitFileSchema.parse(
		JSON.parse(JSON.stringify(saved.file)),
	);
	assert.deepEqual(
		synchronizePcb(reopened, saved.shapes, reopened, symbolDefinitions).file
			.circuit,
		saved.file.circuit,
	);
});

for (const reverse of [false, true]) {
	test(`an explicit alias on another net overrides a hidden generated alias with reversed shape order ${reverse}`, () => {
		const original = createCircuit("Generated alias ownership");
		const file = structuredClone(original);
		const component = componentFromSymbol(connector, []);
		file.circuit.components = [component];
		file.circuit.nets = [
			{
				id: "debug",
				names: ["DEBUG_DATA", "SWDIO"],
				pinIds: [component.pins[0].id],
			},
		];
		const first = synchronizePcb(file, [], original, symbolDefinitions);
		const symbol = createSymbol(100, connector, { x: 200, y: 0 }, "J2");
		const shapes: EditorShape[] = [
			...first.shapes,
			symbol,
			label(101, "SWDIO", firstPin(symbol)),
		];
		const saved = synchronizePcb(
			first.file,
			reverse ? [...shapes].reverse() : shapes,
			first.file,
			symbolDefinitions,
		);
		assert.deepEqual(saved.file.circuit.nets.map((net) => net.names).sort(), [
			["DEBUG_DATA"],
			["SWDIO"],
		]);
		assert.equal(
			saved.file.circuit.nets.find((net) => net.id === "debug")?.pinIds[0],
			component.pins[0].id,
		);
	});
}
