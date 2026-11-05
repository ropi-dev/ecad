import assert from "node:assert/strict";
import { test } from "node:test";
import {
	drawShape,
	type EditorShape,
	symbolShapes,
	symbolTextShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	createEmptySymbolFile,
	parseSymbolFile,
} from "#/components/editor/symbolFormat.ts";
import {
	parseSelection,
	pasteSelection,
	selectionFileText,
	serializeSelection,
} from "#/drawing/clipboard.ts";
import { symbolFileWithShapes } from "#/drawing/symbol-file.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "./helpers/required.ts";

const resistor = () =>
	createSymbol(
		1,
		required(symbolDefinitions.find((symbol) => symbol.prefix === "R")),
		{ x: 0, y: 0 },
		"R1",
	);

test("clipboard round trips mixed shapes without sharing mutable symbol attributes", () => {
	const original = [
		resistor(),
		drawShape(2, "wire", { x: 0, y: 0 }, { x: 10, y: 0 }),
	];
	const source = required(parseSelection(serializeSelection(original)));
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
	const [copy] = required(parseSelection(serializeSelection([symbol])));
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
	const restored = required(parseSelection(file));
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
	const restored = required(parseSelection(selectionFileText([symbol])));
	assert.equal(restored[0].kind, "symbol");
	assert.ok(restored[0].kind === "symbol" && restored[0].netSymbol);
});

test("custom symbols pasted into definitions flatten to saveable geometry with unique IDs", () => {
	const original = {
		...resistor(),
		library: { scope: "project" as const, id: "project-symbols" },
		rotation: Math.PI / 2,
		locked: true,
	};
	const source = required(parseSelection(serializeSelection([original])));
	const before = structuredClone(source);
	const existing = [
		drawShape(1, "rectangle", { x: -30, y: -30 }, { x: -20, y: -20 }),
	];
	const pasted = pasteSelection(
		source,
		existing,
		2,
		{ x: 10, y: -10 },
		"symbol",
	);
	assert.equal(pasted.length, original.children.length + original.texts.length);
	assert.ok(pasted.every((shape) => shape.kind !== "symbol" && shape.locked));
	assert.equal(new Set(pasted.map((shape) => shape.id)).size, pasted.length);
	const expected = [...symbolShapes(original), ...symbolTextShapes(original)];
	for (let i = 0; i < pasted.length; i++) {
		assert.equal(pasted[i].x, expected[i].x + 10);
		assert.equal(pasted[i].y, expected[i].y - 10);
		assert.equal(pasted[i].rotation, expected[i].rotation);
	}
	const file = symbolFileWithShapes(
		createEmptySymbolFile("Clipboard parent", []),
		[...existing, ...pasted],
	);
	assert.doesNotThrow(() => parseSymbolFile(JSON.stringify(file)));
	assert.deepEqual(source, before);
});

test("symbol-editor paste keeps valid library references and rejects forbidden electrical content atomically", () => {
	const symbol = resistor();
	const nested = pasteSelection([symbol], [], 1, { x: 0, y: 0 }, "symbol");
	assert.equal(nested[0].kind, "symbol");
	assert.ok(nested[0].kind === "symbol" && nested[0].library);
	const base = {
		id: 2,
		kind: "text" as const,
		x: 0,
		y: 0,
		width: 10,
		height: 5,
		fontSize: 3,
		lineWidth: 0.254,
		rotation: 0,
		text: "NET",
	};
	const forbidden: EditorShape[] = [
		{ ...base, electrical: "net" },
		{ ...base, electrical: "supply" },
		{ ...symbol, id: 2, netSymbol: true },
	];
	for (const shape of forbidden) {
		const source = [symbol, shape];
		const before = structuredClone(source);
		assert.throws(
			() => pasteSelection(source, [], 1, { x: 0, y: 0 }, "symbol"),
			/cannot be pasted/,
		);
		assert.deepEqual(source, before);
		assert.equal(pasteSelection(source, [], 1, { x: 0, y: 0 }).length, 2);
	}
});

test("symbol-editor paste validates the resulting file limits before returning an edit", () => {
	const shape = drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 10, y: 10 });
	const existing = Array.from({ length: 256 }, (_, i) => ({
		...shape,
		id: i + 1,
	}));
	const before = structuredClone(existing);
	assert.throws(() =>
		pasteSelection([shape], existing, 257, { x: 0, y: 0 }, "symbol"),
	);
	assert.deepEqual(existing, before);
});
