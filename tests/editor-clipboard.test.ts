import assert from "node:assert/strict";
import { test } from "node:test";
import {
	parseSelection,
	pasteSelection,
	selectionFileText,
	serializeSelection,
} from "#/drawing/clipboard.ts";
import { drawShape, type EditorShape } from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";

const resistor = () =>
	createSymbol(
		1,
		symbolDefinitions.find((symbol) => symbol.prefix === "R")!,
		{ x: 0, y: 0 },
		"R1",
	);

test("clipboard round trips mixed shapes without sharing mutable symbol attributes", () => {
	const original = [
		resistor(),
		drawShape(2, "wire", { x: 0, y: 0 }, { x: 10, y: 0 }),
	];
	const source = parseSelection(serializeSelection(original))!;
	assert.equal(source.length, 2);
	const pasted = pasteSelection(source, original, 3, { x: 20, y: -10 });
	assert.deepEqual(
		pasted.map(({ id, x, y }) => ({ id, x, y })),
		[
			{ id: 3, x: 20, y: -10 },
			{ id: 4, x: 25, y: -10 },
		],
	);
	assert.equal(pasted[0].kind, "symbol");
	if (pasted[0].kind !== "symbol") return;
	assert.equal(pasted[0].attributes.reference, "R3");
	pasted[0].attributes.value = "changed";
	assert.notEqual(
		original[0].kind === "symbol" && original[0].attributes.value,
		"changed",
	);
});

test("each pasted symbol gets a reference unused by the destination or other pasted symbols", () => {
	const a = resistor();
	const b = { ...resistor(), id: 2 };
	const existing = [
		{ ...resistor(), attributes: { ...a.attributes, reference: "R10" } },
	];
	const copies = pasteSelection([a, b], existing, 10, { x: 0, y: 0 });
	assert.deepEqual(
		copies.map(
			(shape) => shape.kind === "symbol" && shape.attributes.reference,
		),
		["R11", "R12"],
	);
});

test("project symbols travel as independent inline definitions", () => {
	const symbol = {
		...resistor(),
		library: { scope: "project" as const, id: "project-symbols" },
	};
	const [copy] = parseSelection(serializeSelection([symbol]))!;
	assert.equal(copy.kind, "symbol");
	if (copy.kind !== "symbol") return;
	assert.equal(copy.library, undefined);
	assert.match(copy.definitionId, /^clipboard\./);
	assert.deepEqual(copy.children, symbol.children);
	assert.equal(symbol.library.id, "project-symbols");
});

test("invalid clipboard content cannot become drawing commands", () => {
	for (const text of [
		"hello",
		"{}",
		"{",
		JSON.stringify({
			format: "ecad-selection",
			version: 2,
			shapes: [resistor()],
		}),
		serializeSelection([]),
		serializeSelection([resistor(), resistor()]),
		serializeSelection([{ ...resistor(), x: Infinity }]),
	]) {
		assert.equal(parseSelection(text), null);
	}
});

test("locked geometry and relative wire endpoints survive paste", () => {
	const source: EditorShape[] = [
		{
			...drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 10, y: 20 }),
			locked: true,
		},
		drawShape(2, "wire", { x: 10, y: 0 }, { x: 20, y: 0 }),
	];
	const copies = pasteSelection(source, [], 1, { x: 30, y: -30 });
	assert.equal(copies[0].locked, true);
	for (let i = 0; i < source.length; i++) {
		assert.equal(copies[i].x - source[i].x, 30);
		assert.equal(copies[i].y - source[i].y, -30);
		assert.equal(copies[i].width, source[i].width);
	}
});

test("single symbols have importable save-file text, including built-in definitions", () => {
	const file = selectionFileText([resistor()]);
	const parsed = JSON.parse(file);
	assert.equal(parsed.format, "ecad-symbol");
	assert.equal(parsed.units, "mm");
	assert.notEqual(parsed.id, "resistor");
	const restored = parseSelection(file)!;
	assert.equal(restored[0].kind, "symbol");
	assert.ok(restored[0].kind === "symbol" && restored[0].children.length > 0);
});

test("mixed selections use the drawing save-file structure as plain text", () => {
	const shapes = [
		resistor(),
		drawShape(2, "wire", { x: 0, y: 0 }, { x: 10, y: 0 }),
	];
	const file = selectionFileText(shapes);
	assert.deepEqual(Object.keys(JSON.parse(file)), ["shapes"]);
	assert.deepEqual(parseSelection(file), shapes);
});

test("net symbol files preserve electrical identity", () => {
	const symbol = {
		...resistor(),
		netSymbol: true,
		attributes: { name: "Ground", reference: "", value: "GND" },
	};
	const restored = parseSelection(selectionFileText([symbol]))!;
	assert.equal(restored[0].kind, "symbol");
	assert.ok(restored[0].kind === "symbol" && restored[0].netSymbol);
});
