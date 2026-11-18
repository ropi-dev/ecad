import assert from "node:assert/strict";
import test from "node:test";
import {
	circuitPinSchema,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import { pinBubbleRadius } from "@ecad/drawing-core/drawing/pin-types.ts";
import {
	drawingShapeSchema,
	symbolChildOverridesSchema,
} from "@ecad/drawing-core/drawing/schema.ts";
import {
	drawShape,
	type EditorShape,
	type EditorSymbol,
	symbolChildren,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	DEFAULT_PIN_LENGTH,
	PIN_BUBBLE_RADIUS,
} from "@ecad/drawing-core/drawing/units.ts";
import { runErc } from "@ecad/drawing-core/erc/engine.ts";
import { defaultErcRules } from "@ecad/drawing-core/erc/rules.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import {
	parseSymbolFile,
	symbolFileFromSymbol,
} from "#/components/editor/symbolFormat.ts";
import { buildStaticDisplay } from "#/drawing/display.ts";
import { exportDrawingSvg } from "#/drawing/export.ts";
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
import { defaultSheet } from "#/drawing/worksheet.ts";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import { required } from "./helpers/required.ts";

const pin = (activeLow?: boolean, length = DEFAULT_PIN_LENGTH) => ({
	...drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 }),
	kind: "pin" as const,
	name: "RESET",
	number: "1",
	length,
	...(activeLow === undefined ? {} : { activeLow }),
});
const editContext = (selection: EditorShape[]): SelectionEditContext => ({
	selection,
	shapes: selection,
	nextId: 10,
	allowLocked: false,
	measureText: (text) => text.length,
});
const saved = (activeLow?: boolean) =>
	parseSymbolFile(
		JSON.stringify(
			symbolFileFromSymbol(createSymbolFromShapes(2, [pin(activeLow)])),
		),
	);
const savedPin = (activeLow?: boolean) =>
	required(saved(activeLow).shapes.find((shape) => shape.kind === "pin"));

test("pins are active high unless marked active low, in files and the schema", () => {
	assert.ok(!("activeLow" in savedPin()));
	assert.ok(!("activeLow" in savedPin(false)));
	const low = savedPin(true);
	assert.equal(low.kind === "pin" && low.activeLow, true);
	const loaded = required(
		libraryDefinitions([saved(true)])[0].children.find(
			(child) => child.kind === "pin",
		),
	);
	assert.equal(loaded.kind === "pin" && loaded.activeLow, true);
	assert.ok(drawingShapeSchema.safeParse(pin(true)).success);
	assert.ok(
		!drawingShapeSchema.safeParse({ ...pin(), activeLow: "low" }).success,
	);
});

test("the Active level edit marks a pin active low and back", () => {
	const low = required(
		applySelectionEdit(
			{ kind: "pin", attribute: "activeLow", value: true },
			editContext([pin()]),
		),
	);
	const [edited] = low.replacements;
	assert.equal(edited.kind === "pin" && edited.activeLow, true);
	const [high] = required(
		applySelectionEdit(
			{ kind: "pin", attribute: "activeLow", value: false },
			editContext([edited]),
		),
	).replacements;
	assert.equal(high.kind === "pin" && high.activeLow, undefined);
});

test("a placed symbol's pin overrides its active level for that placement", () => {
	assert.ok(
		editsFixedPin({ kind: "pin", attribute: "activeLow", value: true }),
	);
	const definition = libraryDefinitions([saved()])[0];
	const placed = createSymbol(5, definition, { x: 0, y: 0 });
	const child = required(
		symbolChildren(placed).find(({ shape }) => shape.kind === "pin"),
	);
	const [edited] = required(
		applySelectionEdit(
			{ kind: "pin", attribute: "activeLow", value: true },
			{ ...editContext([placed]), child: { symbol: placed, child } },
		),
	).replacements as EditorSymbol[];
	assert.deepEqual(edited.childOverrides?.[child.key], { activeLow: true });
	assert.ok(
		symbolChildOverridesSchema.safeParse(edited.childOverrides).success,
	);
	const shape = required(
		symbolChildren(edited).find(({ key }) => key === child.key),
	).shape;
	assert.equal(shape.kind === "pin" && shape.activeLow, true);
});

test("an active-low pin draws a bubble where its shortened lead meets the body and an overbar on its name", () => {
	const measure = (text: string) => text.length * 10;
	const display = (shape: EditorShape) =>
		buildStaticDisplay([shape], new Set(), measure).shapes[0];
	const high = display(pin());
	assert.equal(
		high.geometry.kind === "pin" && high.geometry.length,
		DEFAULT_PIN_LENGTH,
	);
	assert.ok(!high.children?.some(({ key }) => key.endsWith(":bubble")));
	const low = display(pin(true));
	assert.equal(
		low.geometry.kind === "pin" && low.geometry.length,
		DEFAULT_PIN_LENGTH - 2 * PIN_BUBBLE_RADIUS,
	);
	const bubble = required(
		low.children?.find(({ key }) => key.endsWith(":bubble")),
	);
	assert.equal(bubble.geometry.kind, "pin-bubble");
	assert.equal(bubble.geometry.width, 2 * PIN_BUBBLE_RADIUS);
	assert.equal(bubble.x * low.width, DEFAULT_PIN_LENGTH - PIN_BUBBLE_RADIUS);
	const number = (shape: EditorShape) => {
		const label = required(
			display(shape).children?.find(({ key }) => key.endsWith(":number")),
		);
		return { x: label.x * high.width, y: label.y * high.height };
	};
	assert.deepEqual(number(pin(true)), number(pin()));
	assert.equal(number(pin(true)).x, DEFAULT_PIN_LENGTH / 2);
	const name = (shape: EditorShape) =>
		required(display(shape).children?.find(({ key }) => key.endsWith(":name")))
			.text;
	assert.equal(name(pin()), "RESET");
	assert.equal(name(pin(true)), "~{RESET}");
	assert.equal(pinBubbleRadius(pin(true, 0.5)), 0.25);
	assert.equal(pinBubbleRadius({ activeLow: true }), 0);
	assert.match(
		exportDrawingSvg([pin(true)], {
			width: 100,
			height: 100,
			area: "drawing",
			background: "white",
			sheet: defaultSheet,
			measureText: measure,
		}),
		/data-name="pin bubble 1"><path [\s\S]*data-name="pin name 1">[\s\S]*?>RESET<\/text><path d="M/,
	);
});

test("KiCad pins with an overbar anywhere in the name import as active low without the markup", () => {
	const source = (name: string) =>
		`(kicad_sch (version 20250114) (paper "A4") (lib_symbols (symbol "Test" (symbol "Test_1_1" (pin input line (at 2 3 0) (length 2) (name "${name}") (number "1"))))) (symbol (lib_id "Test") (at 10 20 0) (unit 1) (uuid "test") (property "Reference" "X1" (at 10 20 0) (effects hide))))`;
	for (const [name, expected] of [
		["~{CS}", { name: "CS", activeLow: true }],
		["~{WP}_IO2", { name: "WP_IO2", activeLow: true }],
		["QSPI_~{SS}", { name: "QSPI_SS", activeLow: true }],
		["CS", { name: "CS", activeLow: undefined }],
	] as const) {
		const symbol = importKiCadSchematic(source(name)).shapes[0];
		assert.equal(symbol.kind, "symbol");
		if (symbol.kind !== "symbol") return;
		const imported = required(
			symbol.children.find((child) => child.kind === "pin"),
		);
		assert.deepEqual(
			imported.kind === "pin"
				? { name: imported.name, activeLow: imported.activeLow }
				: null,
			expected,
			name,
		);
	}
});

test("circuit pins carry the active level, and ERC names an active-low pin", () => {
	const nrf = required(
		symbolDefinitions.find(({ id }) => id === "nrf54l15-qfaa"),
	);
	const placed = createSymbol(1, nrf, { x: 0, y: 0 });
	const resetChild = required(
		symbolChildren(placed).find(
			({ shape }) => shape.kind === "pin" && shape.name === "RESET",
		),
	);
	const reset = (symbol: EditorSymbol) =>
		required(
			componentFromSymbol(
				{
					...nrf,
					children: symbol.children.map((child) => ({
						...child,
						...symbol.childOverrides?.[`shape:${child.id}`],
					})),
				},
				[],
			).pins.find(({ name }) => name === "RESET"),
		);
	assert.equal(reset(placed).activeLow, true);
	const [high] = required(
		applySelectionEdit(
			{ kind: "pin", attribute: "activeLow", value: false },
			{
				...editContext([placed]),
				child: { symbol: placed, child: resetChild },
			},
		),
	).replacements as EditorSymbol[];
	assert.ok(!("activeLow" in reset(high)));
	const circuit = createCircuit("ERC", "circuit").circuit;
	circuit.components = [
		{
			id: "u1",
			reference: "U1",
			value: "",
			part: { id: "test", name: "Test" },
			pins: [
				{
					id: "p1",
					name: "RESET",
					number: "25",
					electricalType: "input",
					activeLow: true,
				},
			],
		},
	];
	assert.deepEqual(
		runErc(circuit, defaultErcRules).map(({ message }) => message),
		[
			"U1 pin 25 (RESET, active low) is unconnected. Connect it or mark it no-connect.",
		],
	);
	assert.ok(circuitPinSchema.safeParse(circuit.components[0].pins[0]).success);
});
