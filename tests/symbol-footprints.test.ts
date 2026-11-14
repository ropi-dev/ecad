import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDefaultFootprints } from "@ecad/default-footprints";
import { generateDefaultSymbols } from "@ecad/default-symbols";
import {
	drawingShapeSchema,
	editorShapeSchema,
} from "@ecad/drawing-core/drawing/schema.ts";
import type {
	EditorShape,
	EditorSymbol,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { symbolReferenceKey } from "@ecad/drawing-core/drawing/symbol-reference.ts";
import {
	matchPinsToPads,
	symbolPinNumbers,
} from "@ecad/drawing-core/footprint/reference.ts";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { applySelectionEdit } from "#/drawing/selection-edit.ts";
import { symbolFileWithShapes } from "#/drawing/symbol-file.ts";
import {
	persistDrawingShapes,
	resolveDrawingSymbols,
} from "#/drawing/symbol-persistence.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { footprintFileSchema } from "#/footprint/format.ts";
import {
	footprintPadNumbers,
	loadBuiltinFootprints,
} from "#/footprint/library.ts";
import { required } from "./helpers/required.ts";

const definition = (id: string) =>
	required(symbolDefinitions.find((symbol) => symbol.id === id));
const editContext = (selection: EditorShape[]) => ({
	selection,
	shapes: selection,
	nextId: 99,
	allowLocked: false,
	measureText: (text: string) => text.length,
});

test("every built-in footprint is a valid footprint file", () => {
	for (const { file } of generateDefaultFootprints())
		assert.deepEqual(footprintFileSchema.parse(file), file, file.id);
});

test("each built-in symbol's default footprint exists and has a pad for every pin", () => {
	const footprints = new Map(
		generateDefaultFootprints().map(({ file }) => [file.id, file]),
	);
	const assigned = new Set<string>();
	for (const { file } of generateDefaultSymbols()) {
		if (!file.footprint) continue;
		assert.equal(file.footprint.library, "builtin");
		const footprint = required(footprints.get(file.footprint.id));
		assigned.add(footprint.id);
		const pins = file.shapes.filter((shape) => shape.kind === "pin");
		assert.deepEqual(
			matchPinsToPads(
				symbolPinNumbers(pins),
				footprintPadNumbers(footprint.shapes),
			),
			{ pinsWithoutPads: [], padsWithoutPins: [] },
			file.id,
		);
	}
	// Several symbols share one footprint, such as the diodes on SOD-123.
	assert.ok(
		generateDefaultSymbols().filter(
			({ file }) => file.footprint?.id === "d_sod-123",
		).length >= 3,
	);
	assert.ok(assigned.size < footprints.size);
});

test("symbols without a package or with one pin have no default footprint", () => {
	for (const id of [
		"ground",
		"signal-ground",
		"vcc",
		"box",
		"antenna",
		"transformer",
		"jfet-n",
		"nrf54l15-caaa",
		"npm2100-caaa",
	])
		assert.equal(definition(id).footprint, undefined, id);
});

test("a placed symbol starts with its definition's footprint, in its own copy", () => {
	const resistor = definition("resistor");
	assert.deepEqual(resistor.footprint, {
		library: "builtin",
		id: "r_0805_2012metric",
	});
	const placed = createSymbol(1, resistor, { x: 0, y: 0 });
	assert.deepEqual(placed.footprint, resistor.footprint);
	assert.notEqual(placed.footprint, resistor.footprint);
	assert.equal(editorShapeSchema.parse(placed).kind, "symbol");
	assert.equal(
		createSymbol(2, definition("vcc"), { x: 0, y: 0 }).footprint,
		undefined,
	);
});

test("the footprint survives saving and resolving a placement", () => {
	const resistor = definition("resistor");
	const placed: EditorSymbol = {
		...createSymbol(1, resistor, { x: 0, y: 0 }),
		footprint: { library: "project", id: "my-0805" },
	};
	const saved = drawingShapeSchema.parse(persistDrawingShapes([placed])[0]);
	assert.ok(!("children" in saved && saved.children.length));
	const references = new Map([
		[symbolReferenceKey(required(resistor.library), resistor.id), resistor],
	]);
	const [restored] = resolveDrawingSymbols(
		[saved],
		[resistor],
		references,
	).shapes;
	assert.deepEqual(
		restored.kind === "symbol" && restored.footprint,
		placed.footprint,
	);
	// A placement saved before footprints existed keeps having none.
	const { footprint: _footprint, ...older } = saved as EditorSymbol;
	const [legacy] = resolveDrawingSymbols(
		[older],
		[resistor],
		references,
	).shapes;
	assert.equal(legacy.kind === "symbol" && legacy.footprint, undefined);
});

test("a footprint reference names a known library and a valid ID", () => {
	const placed = createSymbol(1, definition("resistor"), { x: 0, y: 0 });
	for (const footprint of [
		{ library: "user", id: "r_0805_2012metric" },
		{ library: "builtin", id: "R_0805" },
		{ library: "builtin", id: "r_0805", extra: true },
	])
		assert.equal(
			editorShapeSchema.safeParse({ ...placed, footprint }).success,
			false,
			JSON.stringify(footprint),
		);
});

test("symbol files store an optional default footprint", () => {
	const file = {
		format: "ecad-symbol",
		version: 1,
		units: "mm",
		id: "custom.part",
		name: "Part",
		description: "",
		prefix: "U",
		value: "",
		footprint: { library: "project", id: "part-qfn" },
		shapes: [{ kind: "pin", name: "A", number: "1", x: 0, y: 0 }],
	};
	const parsed = parseSymbolFile(JSON.stringify(file));
	assert.deepEqual(parsed.footprint, file.footprint);
	assert.deepEqual(symbolFileWithShapes(parsed, []).footprint, file.footprint);
	assert.throws(() =>
		parseSymbolFile(
			JSON.stringify({ ...file, footprint: { library: "kicad", id: "x" } }),
		),
	);
	const { footprint: _footprint, ...withoutFootprint } = file;
	assert.equal(
		parseSymbolFile(JSON.stringify(withoutFootprint)).footprint,
		undefined,
	);
});

test("the Attributes panel sets and clears the footprint of every selected component", () => {
	const resistor = createSymbol(1, definition("resistor"), { x: 0, y: 0 });
	const capacitor = createSymbol(2, definition("capacitor"), { x: 5, y: 0 });
	const ground = createSymbol(3, definition("ground"), { x: 10, y: 0 });
	const next = { library: "builtin", id: "r_1206_3216metric" } as const;
	const changed = required(
		applySelectionEdit(
			{ kind: "symbol-footprint", footprint: next },
			editContext([resistor, capacitor, ground]),
		),
	);
	assert.equal(changed.label, "Change footprint");
	assert.deepEqual(
		changed.replacements.map(
			(shape) => shape.kind === "symbol" && shape.footprint,
		),
		[next, next, undefined],
	);
	const cleared = required(
		applySelectionEdit(
			{ kind: "symbol-footprint", footprint: undefined },
			editContext(changed.replacements),
		),
	);
	assert.equal(cleared.label, "Remove footprint");
	assert.ok(cleared.replacements.every((shape) => !("footprint" in shape)));
});

test("the built-in library loads once and groups footprints by KiCad library", async () => {
	const first = await loadBuiltinFootprints();
	assert.equal(await loadBuiltinFootprints(), first);
	assert.equal(first.footprints.length, first.byId.size);
	assert.equal(first.categories[0], "Resistor_SMD");
	assert.ok(first.categories.includes("Package_DFN_QFN"));
	assert.equal(
		required(first.byId.get("sot-23")).category,
		"Package_TO_SOT_SMD",
	);
});
