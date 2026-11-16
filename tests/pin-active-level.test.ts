import assert from "node:assert/strict";
import test from "node:test";
import {
	circuitPinSchema,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import {
	overbarText,
	parseOverbars,
} from "@ecad/drawing-core/drawing/overbar.ts";
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
	symbolTextShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	DEFAULT_PIN_LENGTH,
	PIN_BUBBLE_RADIUS,
	PIN_NUMBER_GAP,
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
import { persistDrawingShapes } from "#/drawing/symbol-persistence.ts";
import {
	createSymbol,
	createSymbolFromShapes,
	symbolDefinitions,
} from "#/drawing/symbols.ts";
import { createTextShape, textLayout } from "#/drawing/text.ts";
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
	assert.equal(low.label, "Change pin active level");
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

test("overbar markup renders without its braces and measures as plain text", () => {
	assert.deepEqual(parseOverbars("~{WP}_IO2"), {
		text: "WP_IO2",
		overbars: [[0, 2]],
	});
	assert.deepEqual(parseOverbars("QSPI_~{SS}"), {
		text: "QSPI_SS",
		overbars: [[5, 7]],
	});
	assert.deepEqual(parseOverbars("~{A}~{B} ~{"), {
		text: "AB ~{",
		overbars: [
			[0, 1],
			[1, 2],
		],
	});
	assert.equal(overbarText("CS"), "~{CS}");
	assert.equal(overbarText("QSPI_~{SS}"), "QSPI_~{SS}");
	const measure = (text: string) => text.length * 10;
	const layout = textLayout("~{USB_BOOT}", measure);
	assert.deepEqual(layout.lines, ["USB_BOOT"]);
	assert.deepEqual(layout.overbars, [[[0, 8]]]);
	assert.equal(layout.width, textLayout("USB_BOOT", measure).width);
	const label = {
		...createTextShape(1, { x: 0, y: 0 }, measure),
		text: "~{USB_BOOT}",
	};
	const svg = exportDrawingSvg([label], {
		width: 100,
		height: 100,
		area: "drawing",
		background: "white",
		sheet: defaultSheet,
		measureText: measure,
	});
	assert.match(svg, />USB_BOOT<\/text><path d="M\d+(\.\d+)? [^h]+h80v/);
	const centered = exportDrawingSvg(
		[
			{
				...createTextShape(1, { x: 0, y: 0 }, measure),
				text: "A~{BC}",
				horizontalAlign: "center" as const,
			},
		],
		{
			width: 100,
			height: 100,
			area: "drawing",
			background: "white",
			sheet: defaultSheet,
			measureText: measure,
		},
	);
	assert.match(centered, /<path d="M31 [^h]+h20v/);
	assert.doesNotMatch(svg, /~\{/);
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

test("KiCad inverted and low-indicator pin styles import as active low", () => {
	const source = (style: string) =>
		`(kicad_sch (version 20250114) (paper "A4") (lib_symbols (symbol "Test" (symbol "Test_1_1" (pin input ${style} (at 2 3 0) (length 2) (name "P") (number "1"))))) (symbol (lib_id "Test") (at 10 20 0) (unit 1) (uuid "test") (property "Reference" "X1" (at 10 20 0) (effects hide))))`;
	for (const [style, expected] of [
		["inverted", true],
		["inverted_clock", true],
		["input_low", true],
		["clock_low", true],
		["output_low", true],
		["line", undefined],
		["clock", undefined],
	] as const) {
		const symbol = importKiCadSchematic(source(style)).shapes[0];
		assert.equal(symbol.kind, "symbol");
		if (symbol.kind !== "symbol") return;
		const imported = required(
			symbol.children.find((child) => child.kind === "pin"),
		);
		assert.equal(
			imported.kind === "pin" ? imported.activeLow : null,
			expected,
			style,
		);
	}
});

test("a placement can set a built-in active-low pin back to active high", () => {
	const nrf = required(
		symbolDefinitions.find(({ id }) => id === "nrf54l15-qgaa"),
	);
	const placed = createSymbol(5, nrf, { x: 0, y: 0 });
	const reset = required(
		symbolChildren(placed).find(
			({ shape }) => shape.kind === "pin" && shape.name === "RESET",
		),
	);
	assert.equal(reset.shape.kind === "pin" && reset.shape.activeLow, true);
	const [edited] = required(
		applySelectionEdit(
			{ kind: "pin", attribute: "activeLow", value: false },
			{ ...editContext([placed]), child: { symbol: placed, child: reset } },
		),
	).replacements as EditorSymbol[];
	assert.deepEqual(edited.childOverrides?.[reset.key], { activeLow: false });
	const [persisted] = persistDrawingShapes([edited]);
	assert.deepEqual(
		persisted.kind === "symbol" && persisted.childOverrides?.[reset.key],
		{ activeLow: false },
	);
	const pin = required(
		buildStaticDisplay(
			[edited],
			new Set(),
			(text) => text.length * 10,
		).connections.find(({ children }) =>
			children?.some(({ text }) => text === "RESET"),
		),
	);
	assert.ok(!pin.children?.some(({ key }) => key.endsWith(":bubble")));
	assert.ok(!pin.children?.some(({ text }) => text === "~{RESET}"));
});

test("setting a standalone pin back to High drops the field", () => {
	const [high] = required(
		applySelectionEdit(
			{ kind: "pin", attribute: "activeLow", value: false },
			editContext([pin(true)]),
		),
	).replacements;
	assert.ok(!("activeLow" in JSON.parse(JSON.stringify(high))));
	assert.equal(overbarText("D}0"), "D}0");
	assert.equal(overbarText("D_{0}"), "~{D_{0}}");
	assert.deepEqual(parseOverbars("~{D_{0}}"), {
		text: "D_{0}",
		overbars: [[0, 5]],
	});
	assert.deepEqual(parseOverbars("~{a{b}"), { text: "~{a{b}", overbars: [] });
	assert.equal(overbarText("A\nB"), "A\nB");
});

test("pin numbers on built-in active-low leads clear the bubble", () => {
	for (const id of [
		"nrf54l15-qfaa",
		"rp2040",
		"w25q128jvs",
		"npm2100-qeaa",
		"npm2100-caaa",
	]) {
		const definition = required(symbolDefinitions.find((d) => d.id === id));
		const placed = createSymbol(1, definition, { x: 0, y: 0 });
		for (const { shape } of symbolChildren(placed)) {
			if (shape.kind !== "pin" || !shape.activeLow || !shape.length) continue;
			const label = required(
				buildStaticDisplay([shape], new Set()).shapes[0].children?.find(
					({ key }) => key.endsWith(":number"),
				),
			);
			const bubble = pinBubbleRadius(shape);
			const height = label.height * shape.height;
			const right =
				(label.x + label.width / 2) * shape.width - (height * 12) / 144;
			const digitInset = (144 - 0.73 * 96) / 2 / 144;
			const inkBottom =
				Math.abs(label.y * shape.height) - height / 2 + height * digitInset;
			assert.ok(
				right <= shape.length - 2 * bubble - shape.lineWidth / 2 ||
					inkBottom >= bubble + shape.lineWidth / 2,
				`${id} ${shape.name}`,
			);
		}
	}
});

test("symbol attribute labels measure overbar markup without the braces", () => {
	const definition = required(
		symbolDefinitions.find(({ id }) => id === "w25q128jvs"),
	);
	const placed = createSymbol(5, definition, { x: 0, y: 0 });
	const width = (value: string) =>
		required(
			symbolTextShapes({
				...placed,
				attributes: { ...placed.attributes, value },
			}).find(({ text }) => text === value),
		).width;
	assert.equal(width("~{RESET}"), width("RESET"));
});

test("every pin number on a lead sits a bubble radius above the usual gap", () => {
	const label = (shape: EditorShape) =>
		required(
			buildStaticDisplay([shape], new Set()).shapes[0].children?.find(
				({ key }) => key.endsWith(":number"),
			),
		);
	for (const shape of [pin(), pin(true), { ...pin(true), number: "56" }]) {
		const number = label(shape);
		const height = number.height * shape.height;
		assert.ok(
			Math.abs(
				number.y * shape.height -
					(height / 2 - PIN_NUMBER_GAP + PIN_BUBBLE_RADIUS),
			) < 1e-9,
		);
	}
	const pointOnly = {
		...drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 }),
		kind: "pin" as const,
		name: "A",
		number: "1",
		length: undefined,
		labelOffset: 2,
	};
	const height = label(pointOnly).height * pointOnly.height;
	assert.ok(
		Math.abs(
			label(pointOnly).y * pointOnly.height - (height / 2 - PIN_NUMBER_GAP),
		) < 1e-9,
	);
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
