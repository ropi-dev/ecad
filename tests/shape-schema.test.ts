import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import {
	createSymbolFromSelectionEffect,
	InvalidDrawingCommand,
	placeRectangleEffect,
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
import { electricalNets } from "#/drawing/named-nets.ts";
import {
	type EditorShape,
	type LineShape,
	type PinShape,
	symbolShapes,
	type WireShape,
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

const kicad = (body: string) =>
	`(kicad_sch (version 20250114) (paper "A4") (lib_symbols) ${body})`;
const kicadWire = (a: string, b: string) => `(wire (pts (xy ${a}) (xy ${b})))`;
const wireEnds = (shapes: readonly EditorShape[]) =>
	shapes.flatMap((wire) =>
		wire.kind === "wire"
			? [
					[-1, 1].map((sign) => ({
						x: wire.x + (sign * Math.cos(wire.rotation) * wire.width) / 2,
						y: wire.y + (sign * Math.sin(wire.rotation) * wire.width) / 2,
					})),
				]
			: [],
	);
const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
	Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
const kicadLabel = (name: string, at: string) =>
	`(label "${name}" (at ${at} 0) (effects (font (size 1.27 1.27))))`;
/**
 * Label names grouped by net. The groups must stay the same after any later
 * command normalizes the wires: an unrelated edit, or an edit of each wire,
 * which makes that wire the one normalization keeps.
 */
function importedNets(...parts: string[]) {
	const result = importKiCadSchematic(kicad(parts.join(" ")));
	const groups = (shapes: readonly EditorShape[]) =>
		electricalNets(shapes)
			.flatMap((net) => (net.names.length ? [net.names.join("+")] : []))
			.sort();
	const imported = groups(result.shapes);
	for (const command of [
		placeRectangleEffect({ ...box, x: 500, y: 500 }),
		...result.shapes.flatMap((shape) =>
			shape.kind === "wire" ? [replaceShapesEffect([shape], "Edit wire")] : [],
		),
	]) {
		const store = createDrawingStore(result.shapes);
		Effect.runSync(command.pipe(Effect.provideService(DrawingStore, store)));
		assert.deepEqual(
			groups(store.getSnapshot().shapes),
			imported,
			"a later command keeps the nets",
		);
	}
	return { ...result, nets: imported };
}

test("KiCad diagonal wires import as connected horizontal and vertical wires", () => {
	const result = importKiCadSchematic(kicad(kicadWire("10 20", "16 28")));
	const wires = result.shapes.filter((shape) => shape.kind === "wire");
	assert.equal(wires.length, 2);
	const ends = wireEnds(wires);
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

test("KiCad diagonal wires turn the corner that joins no other net", () => {
	for (const blocker of [
		[kicadWire("16 20", "20 20"), kicadLabel("C", "20 20")],
		[kicadLabel("C", "16 24")],
		// Within the tolerance on each axis, which wire normalization would join.
		[kicadWire("16.00009 19.99991", "20 19.99991"), kicadLabel("C", "20 19.99991")],
	]) {
		const { shapes, nets } = importedNets(
			kicadWire("10 20", "16 28"),
			kicadLabel("A", "10 20"),
			kicadLabel("B", "16 28"),
			...blocker,
		);
		assert.equal(shapes.filter((shape) => shape.kind === "line").length, 0);
		assert.deepEqual(nets, ["A+B", "C"], blocker.join(" "));
	}
});

test("KiCad diagonal wires keep every connection along their length", () => {
	const { shapes, nets } = importedNets(
		kicadWire("10 20", "16 28"),
		kicadWire("13 24", "20 24"),
		"(junction (at 13 24))",
		kicadLabel("A", "10 20"),
		kicadLabel("B", "16 28"),
		kicadLabel("C", "20 24"),
	);
	assert.equal(shapes.filter((shape) => shape.kind === "line").length, 0);
	assert.deepEqual(nets, ["A+B+C"]);
});

test("KiCad routes survive the wire normalization that the next command runs", () => {
	// A near-vertical diagonal needs a leg shorter than 0.001 mm at either
	// corner. Normalization may delete such a leg, or a stretched one could
	// reach the neighbor, so the diagonal stays a graphic line.
	for (const [end, neighbor, nets] of [
		["10.0002 28", "9.9997 20", ["A", "B", "C"]],
		["10.00009 28", "9.99991 20", ["A+C", "B"]],
	] as const) {
		const short = importedNets(
			kicadWire("10 20", end),
			kicadWire("9 20", neighbor),
			kicadLabel("A", "10 20"),
			kicadLabel("B", end),
			kicadLabel("C", "9 20"),
		);
		assert.equal(short.shapes.filter((shape) => shape.kind === "line").length, 1);
		assert.deepEqual(short.nets, nets);
	}
	// Normalization moves this cluster of near-parallel wires onto y = 20,
	// through both corners, so the diagonal stays a graphic line.
	const cluster = importedNets(
		kicadWire("10 20", "16 28"),
		kicadWire("0 20", "5 20"),
		kicadWire("0 20.00009", "5 20.00009"),
		kicadWire("0 20.00018", "5 20.00018"),
		kicadWire("0 20.00027", "18 20.00027"),
		kicadLabel("B", "16 28"),
		kicadLabel("C", "18 20.00027"),
	);
	assert.deepEqual(cluster.nets, ["B", "C"]);
	assert.equal(cluster.shapes.filter((shape) => shape.kind === "line").length, 1);
});

test("KiCad routes find nets joined by label name anywhere in the drawing", () => {
	const result = importedNets(
		kicadWire("10 20", "16 28"),
		kicadWire("16 20", "100 20"),
		kicadWire("10 28", "0 28"),
		kicadLabel("A", "10 20"),
		kicadLabel("B", "16 28"),
		kicadLabel("A", "100 20"),
		kicadLabel("A", "0 28"),
	);
	assert.equal(result.shapes.filter((shape) => shape.kind === "line").length, 0);
	assert.deepEqual(result.nets, ["A+B"]);
});

test("KiCad routes never join a wire that normalization could move", () => {
	// Both corners need a 0.00009 mm leg, which would bridge the two wires
	// into one cluster and move the right one, so the diagonal stays a line.
	const bridge = importedNets(
		kicadWire("10 20", "16 20.00009"),
		kicadWire("0 20", "10 20"),
		kicadWire("16 20.00009", "100 20.00009"),
		kicadLabel("A", "10 20"),
		kicadLabel("B", "16 20.00009"),
		kicadLabel("C", "100 20.00018"),
	);
	assert.equal(bridge.shapes.filter((shape) => shape.kind === "line").length, 1);
	assert.deepEqual(bridge.nets, ["A", "B+C"]);
	// Running along the left wire 0.00009 mm off would let an edit of the new
	// wire move the left wire away from C. The other corner is safe.
	const offset = importedNets(
		kicadWire("10 20.00009", "16 28"),
		kicadWire("0 20", "10 20"),
		kicadLabel("A", "10 20.00009"),
		kicadLabel("B", "16 28"),
		kicadLabel("C", "9 19.99991"),
	);
	assert.equal(offset.shapes.filter((shape) => shape.kind === "line").length, 0);
	assert.deepEqual(offset.nets, ["A+B+C"]);
});

test("KiCad routes never let normalization fill a gap next to them", () => {
	// The horizontal corner would leave a 0.00009 mm gap to the wire on the
	// left. Filling it reaches C, so the vertical corner is taken instead.
	const leg = importedNets(
		kicadWire("10 20", "16 28"),
		kicadWire("0 20", "9.99991 20"),
		kicadLabel("A", "10 20"),
		kicadLabel("B", "16 28"),
		kicadLabel("C", "9.999955 19.99991"),
	);
	assert.equal(leg.shapes.filter((shape) => shape.kind === "line").length, 0);
	assert.deepEqual(leg.nets, ["A+B", "C"]);
	// These two wires are in line with a 0.00008 mm gap. Filling it would
	// reach the start of either route, so the diagonal stays a line.
	const gap = importedNets(
		kicadWire("10 20.000095", "16 28"),
		kicadWire("0 20", "9.99996 20"),
		kicadWire("10.00004 20", "20 20"),
		kicadLabel("B", "16 28"),
		kicadLabel("C", "0 20"),
		kicadLabel("D", "20 20"),
	);
	assert.equal(gap.shapes.filter((shape) => shape.kind === "line").length, 1);
	assert.deepEqual(gap.nets, ["B", "C+D"]);
});

test("KiCad routes stay clear of slightly tilted wires that normalization straightens", () => {
	// The long wire rises 0.000000008 mm, within the wire rule. Merging with or
	// cutting it would rebuild it on its center line and move it away from C.
	const tilted = importedNets(
		kicadWire("10 20", "16 28"),
		kicadWire("0 20", "20 20.000000008"),
		kicadLabel("A", "10 20"),
		kicadLabel("B", "16 28"),
		kicadLabel("C", "1 19.999900002"),
	);
	assert.equal(tilted.shapes.filter((shape) => shape.kind === "line").length, 1);
	assert.deepEqual(tilted.nets, ["A+C", "B"]);
});

test("KiCad diagonal wires go through the same per-item import checks", () => {
	const result = importKiCadSchematic(
		kicad(
			`${kicadWire("10 20", "16 28")} (wire (pts (xy 0 0) (xy 1 1) (xy 2 0)))`,
		),
	);
	assert.equal(result.shapes.filter((shape) => shape.kind === "wire").length, 2);
	assert.equal(result.report.skipped.length, 1);
	assert.match(result.report.skipped[0].reason, /two endpoints/);
	assert.ok(result.report.warnings.some((warning) => warning.includes("Diagonal")));
});

test("KiCad diagonal wires with no clear corner import as graphic lines", () => {
	const result = importedNets(
		kicadWire("10 20", "16 28"),
		kicadWire("16 20", "20 20"),
		kicadWire("10 28", "4 28"),
		kicadLabel("C", "20 20"),
		kicadLabel("D", "4 28"),
	);
	assert.deepEqual(
		result.shapes.flatMap((shape) => (shape.kind === "text" ? [] : [shape.kind])),
		["wire", "wire", "line"],
	);
	assert.deepEqual(result.nets, ["C", "D"]);
	assert.ok(
		result.report.warnings.some((warning) => warning.includes("graphic lines")),
	);
});

test("an undefined override is committed as saved, so it cannot hide a child field", () => {
	const { accepted, store } = place(
		symbol({ childOverrides: { "shape:1": { width: undefined, x: 1 } } }),
	);
	assert.equal(accepted, true);
	const [stored] = store.getSnapshot().shapes;
	assert.equal(editorShapeSchema.safeParse(stored).success, true);
	assert.deepEqual(stored.kind === "symbol" && stored.childOverrides, {
		"shape:1": { x: 1 },
	});
	assert.equal(stored.kind === "symbol" && symbolShapes(stored)[0].width, 4);
	const dashed = place(
		symbol({
			children: [{ ...box, id: 1, kind: "line", lineStyle: "dashed" }],
			childOverrides: { "shape:1": { lineStyle: undefined } },
		}),
	).store.getSnapshot().shapes[0];
	assert.equal(dashed.kind === "symbol" && "lineStyle" in dashed.childOverrides!["shape:1"], false);
	const [child] = dashed.kind === "symbol" ? symbolShapes(dashed) : [];
	assert.equal(child.kind === "line" && child.lineStyle, "dashed");
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
