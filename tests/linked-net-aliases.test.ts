import assert from "node:assert/strict";
import { test } from "node:test";
import {
	circuitFileSchema,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import {
	type EditorSymbol,
	symbolShapes,
	type TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "./helpers/required.ts";

const connector = required(
	symbolDefinitions.find((definition) => definition.id === "connector-3"),
);
const firstPin = (symbol: EditorSymbol) =>
	required(symbolShapes(symbol).find((shape) => shape.kind === "pin"));
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
