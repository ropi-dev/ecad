import assert from "node:assert/strict";
import { test } from "node:test";
import {
	InvalidDrawingCommand,
	placeRectangleEffect,
	placeShapesEffect,
	replaceShapesEffect,
	type ShapeInput,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { electricalNets } from "@ecad/drawing-core/drawing/named-nets.ts";
import {
	drawingShapeSchema,
	editorShapeSchema,
	legacyDrawingShapeSchema,
} from "@ecad/drawing-core/drawing/schema.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { symbolReferenceKey } from "@ecad/drawing-core/drawing/symbol-reference.ts";
import { Effect, Either } from "effect";
import { selectionPasteError } from "#/drawing/clipboard.ts";
import {
	persistDrawingShapes,
	resolveDrawingSymbols,
} from "#/drawing/symbol-persistence.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import { validateProjectDocument } from "#/projects/format.ts";
import { required } from "./helpers/required.ts";

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
	[
		"empty circuit net ID",
		text({ circuitNet: { id: "", label: "N1" } }),
		false,
	],
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
	[
		"negative KiCad unit",
		symbol({ kicad: { libraryId: "R", unit: -1 } }),
		false,
	],
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

test("command errors name the failing field", () => {
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
	assert.ok(messages.every((message) => message !== ""));
	assert.match(messages[2], /^kind: /);
	assert.match(messages[3], /^childOverrides\.shape:1\.lineWidth: /);
	assert.match(messages[4], /^bold: /);
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
	assert.ok(result.report.warnings.length > 0);
	assert.equal(
		validateProjectDocument({ shapes: result.shapes, symbols: [] }).shapes
			.length,
		2,
	);
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

test("pasting drawing data the schema rejects explains why", () => {
	const selection = (shape: object) =>
		JSON.stringify({ format: "ecad-selection", version: 1, shapes: [shape] });
	assert.notEqual(
		selectionPasteError(
			selection({ ...box, id: 1, kind: "wire", rotation: 1 }),
		),
		undefined,
	);
	assert.match(
		selectionPasteError(selection({ ...box, id: 1, kind: "line", width: 0 })) ??
			"",
		/^width: /,
	);
	assert.equal(
		selectionPasteError(selection({ ...box, id: 1, kind: "line" })),
		undefined,
	);
	assert.equal(selectionPasteError("plain text"), undefined);
	assert.equal(selectionPasteError(JSON.stringify({ shapes: [] })), undefined);
});

test("an edited library symbol drops instance overrides that no longer fit", () => {
	const resistor = required(
		symbolDefinitions.find(({ id }) => id === "resistor"),
	);
	const instance = {
		...createSymbol(1, resistor, { x: 0, y: 0 }),
		childOverrides: {
			"shape:3": { lineStyle: "dashed" as const },
			"shape:4": { name: "OVR" },
		},
	};
	const [saved] = persistDrawingShapes([instance], [resistor]);
	// Deleting the first lead renumbers the children: shape:3 becomes a pin.
	const edited = {
		...resistor,
		children: resistor.children.slice(1).map((child, index) => ({
			...child,
			id: index + 1,
		})),
	};
	const [resolved] = resolveDrawingSymbols(
		[drawingShapeSchema.parse(saved)],
		[edited],
		new Map([
			[symbolReferenceKey(required(edited.library), edited.id), edited],
		]),
	).shapes;
	assert.equal(resolved.kind, "symbol");
	assert.deepEqual(resolved.kind === "symbol" && resolved.childOverrides, {
		"shape:4": { name: "OVR" },
	});
	assert.equal(editorShapeSchema.safeParse(resolved).success, true);
});

test("projects with diagonal wires saved before the wire rule still open", () => {
	// KiCad import on earlier versions saved diagonal wires as they were.
	const legacy = {
		...box,
		id: 1,
		kind: "wire",
		width: 10,
		rotation: Math.PI / 4,
	};
	assert.equal(drawingShapeSchema.safeParse(legacy).success, false);
	assert.equal(legacyDrawingShapeSchema.safeParse(legacy).success, true);
	assert.equal(
		validateProjectDocument({ shapes: [legacy] as EditorShape[], symbols: [] })
			.shapes.length,
		1,
	);
	// New diagonal wires stay rejected everywhere shapes are created or edited.
	assert.equal(place({ ...legacy, id: undefined }).accepted, false);
	assert.notEqual(
		selectionPasteError(JSON.stringify({ shapes: [legacy] })),
		undefined,
	);
});
