import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDefaultSymbols } from "@ecad/default-symbols";
import type {
	EditorSymbol,
	TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "./helpers/required.ts";

test("every generated default is valid portable geometry and has a reserved built-in ID", () => {
	for (const { file, texts, category, packaging } of generateDefaultSymbols()) {
		assert.throws(() => parseSymbolFile(JSON.stringify(file)), /reserved/);
		const custom = { ...file, id: `custom.${file.id}` };
		assert.deepEqual(parseSymbolFile(JSON.stringify(custom)), custom);
		const definition = libraryDefinitions([file])[0];
		assert.deepEqual(
			symbolDefinitions.find(({ id }) => id === file.id),
			{
				...definition,
				texts,
				category,
				...(packaging ? { packaging } : {}),
				library: { scope: "user", id: "builtin" },
			},
		);
		assert.equal(
			definition.children.filter((shape) => shape.kind === "pin").length,
			file.shapes.filter((shape) => shape.kind === "pin").length,
		);
	}
});

test("every default places with its geometry, pin names, and instance attributes", () => {
	for (const [index, { file }] of generateDefaultSymbols().entries()) {
		const definition = required(
			symbolDefinitions.find(({ id }) => id === file.id),
		);
		const symbol = createSymbol(index + 1, definition, { x: 0, y: 0 });
		assert.equal(symbol.definitionId, file.id);
		assert.equal(symbol.children.length, file.shapes.length);
		assert.deepEqual(
			symbol.children
				.filter((child) => child.kind === "pin")
				.map(({ name }) => name),
			file.shapes
				.filter((child) => child.kind === "pin")
				.map(({ name }) => name),
		);
		assert.equal(
			symbol.attributes.reference,
			file.netSymbol ? "" : `${file.prefix}${index + 1}`,
		);
		assert.equal(symbol.attributes.value, file.netSymbol ? "" : file.value);
		if (file.netSymbol) assert.equal(symbol.attributes.name, file.value);
	}
});

test("custom net symbols keep their role through portable and nested library round trips", async () => {
	const { symbolFileWithShapes, symbolFileShapes } = await import(
		"#/drawing/symbol-file.ts"
	);
	const file = {
		...required(generateDefaultSymbols().find(({ file }) => file.id === "vdd"))
			.file,
		id: "custom.power",
	};
	const parsed = parseSymbolFile(JSON.stringify(file));
	assert.equal(parsed.netSymbol, true);
	const definition = {
		...libraryDefinitions([parsed])[0],
		library: { scope: "project" as const, id: "custom" },
	};
	const symbol = createSymbol(1, definition, { x: 0, y: 0 });
	assert.equal(symbol.netSymbol, true);
	const nested = symbolFileWithShapes({ ...parsed, id: "custom.nested" }, [
		{ ...symbol, netSymbol: false },
	]);
	const reopened = symbolFileShapes(
		parseSymbolFile(JSON.stringify(nested)),
		() => definition,
	);
	assert.equal(reopened[0].kind, "symbol");
	assert.equal(reopened[0].kind === "symbol" && reopened[0].netSymbol, false);
});

test("portable net symbols place one visible name label and retain its edits after reload", async () => {
	const {
		symbolTextShapes,
		replaceSymbolChild,
		symbolChildren,
		normalizeNetSymbol,
	} = await import("@ecad/drawing-core/drawing/shapes.ts");
	const { persistDrawingShapes, resolveDrawingSymbols } = await import(
		"#/drawing/symbol-persistence.ts"
	);
	const { drawingShapeSchema } = await import(
		"@ecad/drawing-core/drawing/schema.ts"
	);
	const { symbolReferenceKey } = await import(
		"@ecad/drawing-core/drawing/symbol-reference.ts"
	);
	const original = required(
		generateDefaultSymbols().find(({ file }) => file.id === "vdd"),
	).file;
	const file = parseSymbolFile(
		JSON.stringify({ ...original, id: "custom.net" }),
	);
	const definition = {
		...libraryDefinitions([file])[0],
		library: { scope: "project" as const, id: "custom" },
	};
	const symbol = createSymbol(1, definition, { x: 0, y: 0 });
	assert.deepEqual(
		symbolTextShapes(symbol).map((label) => label.text),
		["VDD"],
	);
	assert.deepEqual(
		symbol.texts.map((label) => label.attribute),
		["name"],
	);
	const { Effect } = await import("effect");
	const { createDrawingStore, DrawingStore } = await import(
		"@ecad/drawing-core/commands/drawing-store.ts"
	);
	const { placeShapesEffect } = await import(
		"@ecad/drawing-core/commands/drawing-commands.ts"
	);
	for (const instance of [
		symbol,
		normalizeNetSymbol({ ...symbol, textPositions: {}, textAlignments: {} }),
	]) {
		const store = createDrawingStore();
		Effect.runSync(
			placeShapesEffect([instance], "Place custom net symbol").pipe(
				Effect.provideService(DrawingStore, store),
			),
		);
		assert.equal(store.getSnapshot().shapes.length, 1);
		assert.deepEqual(
			symbolTextShapes(store.getSnapshot().shapes[0] as EditorSymbol).map(
				(label) => label.text,
			),
			["VDD"],
		);
	}
	const child = required(
		symbolChildren(symbol).find((child) => child.key === "attribute:name"),
	);
	const edited = replaceSymbolChild(symbol, child.key, {
		...child.shape,
		kind: "text",
		text: "CUSTOM",
		x: 12,
		y: 34,
		fontSize: 3,
		horizontalAlign: "right",
	} as TextShape);
	const parsed = drawingShapeSchema.parse(
		JSON.parse(JSON.stringify(persistDrawingShapes([edited], [definition])[0])),
	);
	const resolved = resolveDrawingSymbols(
		[parsed],
		[definition],
		new Map([
			[symbolReferenceKey(definition.library, definition.id), definition],
		]),
	);
	assert.deepEqual(resolved.errors, []);
	const restored = resolved.shapes[0] as EditorSymbol;
	const [label] = symbolTextShapes(restored);
	assert.equal(label.text, "CUSTOM");
	assert.equal(label.x, 12);
	assert.equal(label.y, 34);
	assert.equal(label.fontSize, 3);
	assert.equal(label.horizontalAlign, "right");
	assert.deepEqual(restored.attributes, {
		name: "CUSTOM",
		reference: "",
		value: "",
	});
});
