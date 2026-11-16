import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDefaultSymbols, partAttributes } from "@ecad/default-symbols";
import {
	drawingShapeSchema,
	editorShapeSchema,
} from "@ecad/drawing-core/drawing/schema.ts";
import type { EditorSymbol } from "@ecad/drawing-core/drawing/shapes.ts";
import { SYMBOL_ATTRIBUTE_LIMIT } from "@ecad/drawing-core/drawing/symbol-attributes.ts";
import { symbolReferenceKey } from "@ecad/drawing-core/drawing/symbol-reference.ts";
import {
	parseSymbolFile,
	symbolFileFromSymbol,
} from "#/components/editor/symbolFormat.ts";
import { applySelectionEdit } from "#/drawing/selection-edit.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import {
	persistDrawingShapes,
	resolveDrawingSymbols,
} from "#/drawing/symbol-persistence.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "./helpers/required.ts";

const part = {
	format: "ecad-symbol",
	version: 1,
	units: "mm",
	id: "custom.sensor",
	name: "Sensor",
	description: "",
	prefix: "U",
	value: "TMP117",
	attributes: { Manufacturer: "Texas Instruments", Tolerance: "0.1 °C" },
	shapes: [
		{ kind: "rectangle", x: 0, y: 0, width: 4, height: 4 },
		{ kind: "pin", name: "SDA", x: -4, y: 0 },
	],
};
const builtin = (id: string) =>
	required(symbolDefinitions.find((definition) => definition.id === id));

test("built-in components define part attributes and net symbols and annotations do not", () => {
	for (const { file, category } of generateDefaultSymbols()) {
		const names = Object.keys(file.attributes ?? {});
		if (file.netSymbol || category === "Annotations")
			assert.deepEqual(names, [], file.id);
		else assert.deepEqual(names, [...partAttributes], file.id);
		for (const link of [file.attributes?.Datasheet ?? ""].filter(Boolean))
			assert.match(link, /^https?:\/\/\S+$/, file.id);
	}
	assert.deepEqual(builtin("rp2040").attributes, {
		Manufacturer: "Raspberry Pi",
		"Part number": "RP2040",
		Datasheet: "https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf",
		"Distributor part number": "",
	});
	assert.equal(builtin("w25q128jvs").attributes?.Manufacturer, "Winbond");
	assert.equal(builtin("resistor").attributes?.Manufacturer, "");
});

test("a placement starts with its definition's attributes and edits only its own copy", () => {
	const definition = builtin("rp2040");
	const placed = createSymbol(1, definition, { x: 0, y: 0 });
	assert.deepEqual(Object.keys(placed.attributes), [
		"name",
		"reference",
		"value",
		...partAttributes,
	]);
	assert.equal(placed.attributes["Part number"], "RP2040");
	const edited = required(
		applySelectionEdit(
			{
				kind: "symbol-attribute",
				attribute: "Distributor part number",
				value: "DIST-12345",
			},
			{
				selection: [placed],
				shapes: [placed],
				nextId: 2,
				allowLocked: false,
				measureText: (text) => text.length,
			},
		),
	).replacements[0] as EditorSymbol;
	assert.equal(edited.attributes["Distributor part number"], "DIST-12345");
	assert.equal(definition.attributes?.["Distributor part number"], "");
	assert.equal(
		createSymbol(2, definition, { x: 0, y: 0 }).attributes[
			"Distributor part number"
		],
		"",
	);
});

test("symbol files keep their attribute order and reject attributes that clash or repeat", () => {
	const file = parseSymbolFile(JSON.stringify(part));
	assert.deepEqual(Object.entries(file.attributes ?? {}), [
		["Manufacturer", "Texas Instruments"],
		["Tolerance", "0.1 °C"],
	]);
	const invalid = (attributes: Record<string, string>, message: RegExp) =>
		assert.throws(
			() => parseSymbolFile(JSON.stringify({ ...part, attributes })),
			message,
		);
	invalid({ Value: "10k" }, /already an attribute of every symbol/);
	invalid({ " Manufacturer": "" }, /start or end with a space/);
	invalid({ "42": "" }, /only digits/);
	assert.throws(
		() =>
			parseSymbolFile(
				JSON.stringify(part).replace('"Manufacturer"', '"__proto__"'),
			),
		/__proto__ cannot be an attribute name/,
	);
	invalid({ MPN: "", mpn: "" }, /repeated/);
	invalid({ Datasheet: "x".repeat(2001) }, /at most 2000 characters/);
	invalid(
		Object.fromEntries(
			Array.from({ length: SYMBOL_ATTRIBUTE_LIMIT + 1 }, (_, index) => [
				`Field ${index}`,
				"",
			]),
		),
		/at most 32 attributes/,
	);
});

test("placements save their attributes and pick up ones their definition added later", () => {
	const [definition] = libraryDefinitions([
		parseSymbolFile(JSON.stringify(part)),
	]);
	const library = { scope: "project" as const, id: "project-symbols" };
	const linked = { ...definition, library };
	const placed = createSymbol(1, linked, { x: 0, y: 0 });
	const edited = {
		...placed,
		attributes: { ...placed.attributes, Manufacturer: "TI" },
	};
	const saved = drawingShapeSchema.parse(
		JSON.parse(JSON.stringify(persistDrawingShapes([edited], [linked])[0])),
	) as EditorSymbol;
	assert.equal(saved.attributes.Manufacturer, "TI");
	const older = {
		...saved,
		attributes: { name: "Sensor", reference: "U1", value: "TMP117" },
	};
	const [resolved] = resolveDrawingSymbols(
		[older, saved],
		[linked],
		new Map([[symbolReferenceKey(library, linked.id), linked]]),
	).shapes as EditorSymbol[];
	assert.deepEqual(resolved.attributes, {
		name: "Sensor",
		reference: "U1",
		value: "TMP117",
		Manufacturer: "Texas Instruments",
		Tolerance: "0.1 °C",
	});
	assert.equal(
		(
			resolveDrawingSymbols(
				[saved],
				[linked],
				new Map([[symbolReferenceKey(library, linked.id), linked]]),
			).shapes[0] as EditorSymbol
		).attributes.Manufacturer,
		"TI",
	);
});

test("drawings reject invalid placement attributes and copies carry them as defaults", () => {
	const placed = createSymbol(1, builtin("ams1117-3.3"), { x: 0, y: 0 });
	assert.ok(editorShapeSchema.safeParse(placed).success);
	const issue = editorShapeSchema.safeParse({
		...placed,
		attributes: { ...placed.attributes, "": "x" },
	}).error?.issues[0];
	assert.match(issue?.message ?? "", /Enter an attribute name/);
	assert.deepEqual(issue?.path, ["attributes", ""]);
	const copy = symbolFileFromSymbol({
		...placed,
		definitionId: "custom.regulator",
		attributes: { ...placed.attributes, Datasheet: "" },
	});
	assert.deepEqual(copy.attributes, {
		Manufacturer: "Advanced Monolithic Systems",
		"Part number": "AMS1117-3.3",
		Datasheet: "",
		"Distributor part number": "",
	});
});

test("a renamed or crowded definition never makes a placement unsaveable", () => {
	const library = { scope: "project" as const, id: "project-symbols" };
	const resolve = (
		placementAttributes: Record<string, string>,
		attributes: Record<string, string>,
	) => {
		const [definition] = libraryDefinitions([
			parseSymbolFile(JSON.stringify({ ...part, attributes })),
		]);
		const linked = { ...definition, library };
		const placed = createSymbol(1, linked, { x: 0, y: 0 });
		const saved = persistDrawingShapes(
			[
				{
					...placed,
					attributes: {
						name: "Sensor",
						reference: "U1",
						value: "TMP117",
						...placementAttributes,
					},
				},
			],
			[linked],
		);
		const [resolved] = resolveDrawingSymbols(
			saved.map((shape) =>
				drawingShapeSchema.parse(JSON.parse(JSON.stringify(shape))),
			),
			[linked],
			new Map([[symbolReferenceKey(library, linked.id), linked]]),
		).shapes as EditorSymbol[];
		const reparsed = drawingShapeSchema.safeParse(
			JSON.parse(JSON.stringify(persistDrawingShapes([resolved], [linked])[0])),
		);
		assert.ok(reparsed.success, reparsed.error?.message);
		return resolved.attributes;
	};
	assert.deepEqual(
		resolve(
			{ "part number": "A", Tolerance: "1" },
			{ "Part number": "", Datasheet: "x" },
		),
		{
			name: "Sensor",
			reference: "U1",
			value: "TMP117",
			Datasheet: "x",
			"part number": "A",
			Tolerance: "1",
		},
	);
	const full = Object.fromEntries(
		Array.from({ length: SYMBOL_ATTRIBUTE_LIMIT }, (_, index) => [
			`Field ${index}`,
			"",
		]),
	);
	const crowded = resolve(full, { "Field 0": "default", Added: "x" });
	assert.equal(crowded.Added, undefined);
	assert.equal(crowded["Field 0"], "");
});
