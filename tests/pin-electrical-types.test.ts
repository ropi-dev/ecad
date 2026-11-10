import assert from "node:assert/strict";
import test from "node:test";
import { drawingShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	drawShape,
	type EditorShape,
	type EditorSymbol,
	symbolChildren,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import {
	parseSymbolFile,
	symbolFileFromSymbol,
} from "#/components/editor/symbolFormat.ts";
import {
	applySelectionEdit,
	editsFixedPin,
	type SelectionEditContext,
} from "#/drawing/selection-edit.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import {
	createSymbol,
	createSymbolFromShapes,
	symbolDefinitions,
} from "#/drawing/symbols.ts";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import { required } from "./helpers/required.ts";

const pin = (electricalType?: "input" | "power-out") => ({
	...drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 }),
	kind: "pin" as const,
	name: "IN",
	number: "1",
	...(electricalType ? { electricalType } : {}),
});
const editContext = (selection: EditorShape[]): SelectionEditContext => ({
	selection,
	shapes: selection,
	nextId: 10,
	allowLocked: false,
	measureText: (text) => text.length,
});

test("pin electrical types survive symbol files and validate against KiCad's list", () => {
	const symbol = createSymbolFromShapes(2, [pin("input")]);
	const saved = parseSymbolFile(JSON.stringify(symbolFileFromSymbol(symbol)));
	const savedPin = required(saved.shapes.find((shape) => shape.kind === "pin"));
	assert.equal(savedPin.kind === "pin" && savedPin.electricalType, "input");
	const loaded = required(
		libraryDefinitions([saved])[0].children.find(
			(child) => child.kind === "pin",
		),
	);
	assert.equal(loaded.kind === "pin" && loaded.electricalType, "input");
	assert.ok(drawingShapeSchema.safeParse(pin("power-out")).success);
	assert.ok(
		!drawingShapeSchema.safeParse({ ...pin(), electricalType: "power_in" })
			.success,
	);
	assert.throws(() =>
		parseSymbolFile(
			JSON.stringify({
				...saved,
				shapes: [{ kind: "pin", x: 0, y: 0, electricalType: "analog" }],
			}),
		),
	);
});

test("the Attributes panel edit changes a pin's type in one step", () => {
	const result = required(
		applySelectionEdit(
			{ kind: "pin", attribute: "electricalType", value: "power-out" },
			editContext([pin()]),
		),
	);
	assert.equal(result.label, "Change pin type");
	const [edited] = result.replacements;
	assert.equal(edited.kind === "pin" && edited.electricalType, "power-out");
});

test("a pin fixed to its placed symbol accepts only type and label visibility edits", () => {
	assert.ok(
		editsFixedPin({
			kind: "pin",
			attribute: "electricalType",
			value: "input",
		}),
	);
	for (const attribute of ["showName", "showNumber"] as const)
		assert.ok(editsFixedPin({ kind: "pin", attribute, value: false }));
	assert.ok(!editsFixedPin({ kind: "pin", attribute: "name", value: "X" }));
	assert.ok(!editsFixedPin({ kind: "attribute", attribute: "x", value: 1 }));
});

test("circuit pins take the symbol's types, including an instance override", () => {
	const opAmp = required(symbolDefinitions.find(({ id }) => id === "op-amp"));
	const types = (symbol: EditorSymbol) =>
		componentFromSymbol(
			{
				...opAmp,
				children: symbol.children.map((child) => ({
					...child,
					...symbol.childOverrides?.[`shape:${child.id}`],
				})),
			},
			[],
		).pins.map(({ name, electricalType }) => `${name}:${electricalType}`);
	const placed = createSymbol(5, opAmp, { x: 0, y: 0 });
	assert.deepEqual(types(placed), [
		"+:input",
		"V-:power-in",
		"-:input",
		"OUT:output",
		"V+:power-in",
	]);
	const output = required(
		symbolChildren(placed).find(
			(child) => child.shape.kind === "pin" && child.shape.name === "OUT",
		),
	);
	const edited = required(
		applySelectionEdit(
			{ kind: "pin", attribute: "electricalType", value: "open-collector" },
			{ ...editContext([placed]), child: { symbol: placed, child: output } },
		),
	).replacements[0] as EditorSymbol;
	assert.deepEqual(edited.childOverrides?.[output.key], {
		electricalType: "open-collector",
	});
	assert.ok(types(edited).includes("OUT:open-collector"));
	assert.ok(drawingShapeSchema.safeParse(edited).success);
});

test("KiCad imports keep pin electrical types", () => {
	const source = (type: string) =>
		`(kicad_sch (version 20250114) (paper "A4") (lib_symbols (symbol "Test" (symbol "Test_1_1" (pin ${type} line (at 2 3 0) (length 2) (name "P") (number "1"))))) (symbol (lib_id "Test") (at 10 20 0) (unit 1) (uuid "test") (property "Reference" "X1" (at 10 20 0) (effects hide))))`;
	for (const [type, expected] of [
		["power_in", "power-in"],
		["tri_state", "tri-state"],
		["open_collector", "open-collector"],
		["no_connect", "no-connect"],
		["passive", undefined],
	] as const) {
		const symbol = importKiCadSchematic(source(type)).shapes[0];
		assert.equal(symbol.kind, "symbol");
		if (symbol.kind !== "symbol") return;
		const imported = required(
			symbol.children.find((child) => child.kind === "pin"),
		);
		assert.equal(
			imported.kind === "pin" ? imported.electricalType : null,
			expected,
			type,
		);
	}
});
