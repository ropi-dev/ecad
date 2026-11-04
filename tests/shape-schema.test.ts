import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import {
	createSymbolFromSelectionEffect,
	InvalidDrawingCommand,
	placeShapesEffect,
	replaceShapesEffect,
	type ShapeInput,
} from "#/commands/drawing-commands.ts";
import { createDrawingStore, DrawingStore } from "#/commands/drawing-store.ts";
import { selectionPasteError } from "#/drawing/clipboard.ts";
import {
	drawingShapeSchema,
	editorShapeSchema,
	symbolChildOverridesSchema,
} from "#/drawing/schema.ts";
import type {
	EditorShape,
	LineShape,
	PinShape,
	WireShape,
} from "#/drawing/shapes.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import { validateProjectDocument } from "#/projects/format.ts";

const box = { x: 0, y: 0, width: 4, height: 4, rotation: 0, lineWidth: 0.2 };
const text = (extra: object) => ({
	...box,
	kind: "text",
	text: "N1",
	fontSize: 1.27,
	...extra,
});
const symbol = (extra: object) => ({
	...box,
	kind: "symbol",
	definitionId: "custom",
	children: [
		{ ...box, id: 1, kind: "circle" },
		{ ...box, id: 2, kind: "wire", rotation: Math.PI / 4 },
		{ ...box, id: 3, kind: "pin", name: "A", number: "1" },
	],
	texts: [],
	attributes: { name: "Custom", reference: "U1", value: "" },
	...extra,
});

function place(shape: unknown) {
	const store = createDrawingStore();
	const result = Effect.runSync(
		Effect.either(
			placeShapesEffect([shape as ShapeInput], "Place").pipe(
				Effect.provideService(DrawingStore, store),
			),
		),
	);
	if (Either.isLeft(result))
		assert.ok(result.left instanceof InvalidDrawingCommand);
	return { accepted: Either.isRight(result), store };
}

/** [case, accepted]. Each shape must get the same verdict from both paths. */
const cases: [string, object, boolean][] = [
	["round circle", { ...box, kind: "circle" }, true],
	["oval circle", { ...box, kind: "circle", height: 2 }, false],
	["horizontal wire", { ...box, kind: "wire" }, true],
	["collapsed wire", { ...box, kind: "wire", width: 0 }, true],
	["diagonal wire", { ...box, kind: "wire", rotation: Math.PI / 4 }, false],
	["filled wire", { ...box, kind: "wire", filled: false }, false],
	["dashed wire", { ...box, kind: "wire", lineStyle: "dashed" }, false],
	["dashed line", { ...box, kind: "line", lineStyle: "dashed" }, true],
	["filled line", { ...box, kind: "line", filled: true }, false],
	["zero-length line", { ...box, kind: "line", width: 0 }, false],
	["zero-width rectangle", { ...box, kind: "rectangle", width: 0 }, false],
	["zero-stroke rectangle", { ...box, kind: "rectangle", lineWidth: 0 }, false],
	["filled no-connect", { ...box, kind: "no-connect", filled: true }, true],
	["bold text", text({ bold: true }), true],
	["non-boolean bold", text({ bold: "yes" }), false],
	[
		"circuit net",
		text({ electrical: "net", circuitNet: { id: "n1", label: "N1" } }),
		true,
	],
	["empty circuit net ID", text({ circuitNet: { id: "", label: "N1" } }), false],
	[
		"circuit net without a label",
		text({ circuitNet: { id: "n1", pinId: "p1" } }),
		false,
	],
	[
		"unknown circuit net field",
		text({ circuitNet: { id: "n1", label: "N1", net: 1 } }),
		false,
	],
	["KiCad source", symbol({ kicad: { libraryId: "Device:R", unit: 1 } }), true],
	[
		"KiCad source without a library",
		symbol({ kicad: { libraryId: "", unit: 1 } }),
		false,
	],
	[
		"fractional KiCad unit",
		symbol({ kicad: { libraryId: "Device:R", unit: 1.5 } }),
		false,
	],
	["negative KiCad unit", symbol({ kicad: { libraryId: "R", unit: -1 } }), false],
	["diagonal symbol wire", symbol({}), true],
	[
		"duplicate child IDs",
		symbol({ children: [symbol({}).children[0], symbol({}).children[0]] }),
		false,
	],
	[
		"electrical child label",
		symbol({ children: [{ ...text({ electrical: "net" }), id: 1 }] }),
		false,
	],
	[
		"thin child stroke override",
		symbol({ childOverrides: { "shape:1": { lineWidth: 0.001 } } }),
		true,
	],
	[
		"zero child stroke override",
		symbol({ childOverrides: { "shape:1": { lineWidth: 0 } } }),
		false,
	],
	[
		"zero child width override",
		symbol({ childOverrides: { "shape:1": { width: 0 } } }),
		false,
	],
	[
		"zero child wire length override",
		symbol({ childOverrides: { "shape:2": { width: 0 } } }),
		false,
	],
	[
		"override that makes a circle oval",
		symbol({ childOverrides: { "shape:1": { width: 2 } } }),
		false,
	],
	[
		"override field the child does not have",
		symbol({ childOverrides: { "shape:1": { fontSize: 2 } } }),
		false,
	],
	[
		"override that resizes a circle",
		symbol({ childOverrides: { "shape:1": { width: 2, height: 2 } } }),
		true,
	],
];

for (const [name, shape, accepted] of cases) {
	test(`the drawing schema and commands agree on a ${name}`, () => {
		const saved = drawingShapeSchema.safeParse({ ...shape, id: 1 }).success;
		assert.equal(saved, accepted, "drawing schema");
		assert.equal(
			editorShapeSchema.safeParse({ ...shape, id: 1 }).success,
			accepted,
			"editor schema",
		);
		assert.equal(place(shape).accepted, accepted, "place command");
	});
}

test("wires and lines cannot carry fields they never draw", () => {
	const wire: WireShape = { ...box, id: 1, kind: "wire" };
	const line: LineShape = { ...box, id: 2, kind: "line", lineStyle: "dashed" };
	// @ts-expect-error Wires have no fill.
	const filledWire: WireShape = { ...wire, filled: true };
	// @ts-expect-error Wires have no line style.
	const dashedWire: WireShape = { ...wire, lineStyle: "dashed" };
	// @ts-expect-error Lines have no fill.
	const filledLine: LineShape = { ...line, filled: true };
	for (const shape of [filledWire, dashedWire, filledLine])
		assert.equal(drawingShapeSchema.safeParse(shape).success, false);
	assert.equal(drawingShapeSchema.safeParse(line).success, true);
});

test("command errors name the failing field and keep rule messages readable", () => {
	const store = createDrawingStore();
	const run = (shape: unknown) =>
		Effect.runSync(
			Effect.either(
				placeShapesEffect([shape as ShapeInput], "Place").pipe(
					Effect.provideService(DrawingStore, store),
				),
			),
		);
	const messages = [
		{ ...box, kind: "wire", rotation: 1 },
		{ ...box, kind: "circle", height: 1 },
		{ ...box, kind: "hexagon" },
		symbol({ childOverrides: { "shape:1": { lineWidth: 0 } } }),
		text({ bold: "yes" }),
	].map((shape) => {
		const result = run(shape);
		return Either.isLeft(result) ? result.left.message : "";
	});
	assert.deepEqual(messages.slice(0, 3), [
		"Wire segments must be horizontal or vertical.",
		"A circle must have equal width and height.",
		"kind: A supported shape kind is required.",
	]);
	assert.match(messages[3], /^childOverrides\.shape:1\.lineWidth: /);
	assert.match(messages[4], /^bold: /);
});

test("commands validate the saved form, where undefined fields disappear", () => {
	const store = createDrawingStore();
	const run = <A, E>(program: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(program.pipe(Effect.provideService(DrawingStore, store)));
	run(
		placeShapesEffect(
			[
				{ ...box, kind: "rectangle" },
				{
					...text({}),
					electrical: undefined,
					circuitNet: undefined,
				} as ShapeInput,
			],
			"Place",
		),
	);
	const wire = { ...box, id: 3, kind: "wire", lineStyle: undefined };
	run(placeShapesEffect([wire as ShapeInput], "Wire"));
	const created = run(createSymbolFromSelectionEffect([1, 2]));
	const shapes = store.getSnapshot().shapes;
	assert.equal(shapes.find(({ id }) => id === created.ids[0])?.kind, "symbol");
	const placed = shapes.find((shape) => shape.kind === "wire");
	const replaced = Effect.runSync(
		Effect.either(
			replaceShapesEffect(
				[{ ...placed, lineStyle: "dashed" } as EditorShape],
				"Style wire",
			).pipe(Effect.provideService(DrawingStore, store)),
		),
	);
	assert.ok(Either.isLeft(replaced));
	assert.match(replaced.left.message, /Unrecognized key: "lineStyle"/);
});

test("saved shapes may omit defaulted fields, but shapes in memory may not", () => {
	const pin = { ...box, id: 1, kind: "pin" as const };
	assert.deepEqual(drawingShapeSchema.parse(pin), {
		...pin,
		name: "",
		number: "",
	} satisfies PinShape);
	assert.equal(editorShapeSchema.safeParse(pin).success, false);
	assert.equal(place(pin).accepted, false);
	const reference = symbol({
		library: { scope: "user", id: "builtin" },
		definitionId: "resistor",
	}) as Record<string, unknown>;
	delete reference.children;
	delete reference.texts;
	const parsed = drawingShapeSchema.parse({ ...reference, id: 1 });
	assert.equal(parsed.kind === "symbol" && parsed.children.length, 0);
	assert.equal(place(reference).accepted, false);
	assert.equal(place({ ...reference, children: [], texts: [] }).accepted, true);
});

test("symbol files and drawings share the child-override limits", () => {
	const nested = (override: object) =>
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "override-limits",
			name: "Override limits",
			description: "",
			prefix: "U",
			value: "",
			shapes: [
				{
					kind: "symbol",
					library: { scope: "user", id: "builtin" },
					definitionId: "resistor",
					x: 0,
					y: 0,
					childOverrides: { "shape:2": override },
				},
			],
		});
	const resistor = symbolDefinitions.find(({ id }) => id === "resistor")!;
	const drawing = (override: object) => ({
		...createSymbol(1, resistor, { x: 0, y: 0 }),
		childOverrides: { "shape:2": override },
	});
	for (const [override, accepted] of [
		[{ x: 1000, y: -1000 }, true],
		[{ x: 1000.5 }, false],
		[{ y: -1001 }, false],
		[{ width: 1000, height: 1000 }, true],
		[{ width: 1001 }, false],
		[{ height: 0.005 }, true],
		[{ width: 0 }, false],
		[{ lineWidth: 0 }, false],
		[{ lineWidth: 1001 }, false],
		[{ fontSize: 0 }, false],
		[{ length: 1000 }, true],
		[{ length: 1001 }, false],
		[{ rotation: 7 }, true],
		[{ lineStyle: "wavy" }, false],
		[{ bold: true }, false],
	] as const) {
		const label = JSON.stringify(override);
		assert.equal(
			symbolChildOverridesSchema.safeParse({ "shape:2": override }).success,
			accepted,
			`override schema ${label}`,
		);
		assert.equal(
			(() => {
				try {
					parseSymbolFile(nested(override));
					return true;
				} catch {
					return false;
				}
			})(),
			accepted,
			`symbol file ${label}`,
		);
		// The rectangle body also has no pin length or font size.
		const fits = !("length" in override) && !("fontSize" in override);
		assert.equal(
			drawingShapeSchema.safeParse(drawing(override)).success,
			accepted && fits,
			`drawing ${label}`,
		);
	}
	assert.throws(
		() => parseSymbolFile(nested({ lineWidth: 0 })),
		/childOverrides: shape:2\.lineWidth: Too small/,
	);
});

test("symbol-file wires drop a line style that wires cannot draw", () => {
	const file = parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "styled-wires",
			name: "Styled wires",
			description: "",
			prefix: "U",
			value: "",
			shapes: [
				{ kind: "wire", x1: 0, y1: 0, x2: 3, y2: 4, lineStyle: "dashed" },
				{ kind: "line", x1: 0, y1: 0, x2: 0, y2: 4, lineStyle: "dashed" },
			],
		}),
	);
	const [definition] = libraryDefinitions([file]);
	assert.equal("lineStyle" in definition.children[0], false);
	assert.equal(
		definition.children[1].kind === "line" && definition.children[1].lineStyle,
		"dashed",
	);
	assert.equal(
		place(createSymbol(1, definition, { x: 0, y: 0 })).accepted,
		true,
	);
});

test("KiCad diagonal wires import as connected horizontal and vertical wires", () => {
	const result = importKiCadSchematic(
		'(kicad_sch (version 20250114) (paper "A4") (lib_symbols) (wire (pts (xy 10 20) (xy 16 28)) (uuid "w")))',
	);
	const wires = result.shapes.filter((shape) => shape.kind === "wire");
	assert.equal(wires.length, 2);
	const ends = wires.map((wire) =>
		[-1, 1].map((sign) => ({
			x: wire.x + (sign * Math.cos(wire.rotation) * wire.width) / 2,
			y: wire.y + (sign * Math.sin(wire.rotation) * wire.width) / 2,
		})),
	);
	const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
		Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
	assert.ok(near(ends[0][1], ends[1][0]), "the segments share a corner");
	assert.ok(Math.abs(ends[0][0].x - ends[1][1].x + 6) < 1e-9);
	assert.ok(Math.abs(Math.abs(ends[0][0].y - ends[1][1].y) - 8) < 1e-9);
	assert.deepEqual(
		wires.map((wire) => Math.round(Math.abs(Math.sin(wire.rotation)))),
		[0, 1],
	);
	assert.ok(result.report.warnings.some((warning) => warning.includes("Diagonal")));
	assert.equal(
		validateProjectDocument({ shapes: result.shapes, symbols: [] }).shapes.length,
		2,
	);
});

test("pasting drawing data the schema rejects explains why", () => {
	const selection = (shape: object) =>
		JSON.stringify({ format: "ecad-selection", version: 1, shapes: [shape] });
	assert.equal(
		selectionPasteError(selection({ ...box, id: 1, kind: "wire", rotation: 1 })),
		"Wire segments must be horizontal or vertical.",
	);
	assert.match(
		selectionPasteError(selection({ ...box, id: 1, kind: "line", width: 0 })) ??
			"",
		/^width: Too small/,
	);
	assert.equal(selectionPasteError(selection({ ...box, id: 1, kind: "line" })), undefined);
	assert.equal(selectionPasteError("plain text"), undefined);
	assert.equal(selectionPasteError(JSON.stringify({ shapes: [] })), undefined);
});
