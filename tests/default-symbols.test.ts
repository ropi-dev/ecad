import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDefaultSymbols } from "@ecad/default-symbols";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";

test("every generated default is valid portable geometry and has a reserved built-in ID", () => {
	for (const { file, texts, category } of generateDefaultSymbols()) {
		assert.throws(() => parseSymbolFile(JSON.stringify(file)), /reserved/);
		const custom = { ...file, id: `custom.${file.id}` };
		assert.deepEqual(parseSymbolFile(JSON.stringify(custom)), custom);
		const definition = libraryDefinitions([file])[0];
		assert.deepEqual(symbolDefinitions.find(({ id }) => id === file.id), { ...definition, texts, category, library: { scope: "user", id: "builtin" } });
		assert.equal(definition.children.filter((shape) => shape.kind === "pin").length,
			file.shapes.filter((shape) => shape.kind === "pin").length);
	}
});

test("every default places with its geometry, pin names, and instance attributes", () => {
	for (const [index, { file }] of generateDefaultSymbols().entries()) {
		const definition = symbolDefinitions.find(({ id }) => id === file.id)!;
		const symbol = createSymbol(index + 1, definition, { x: 0, y: 0 });
		assert.equal(symbol.definitionId, file.id);
		assert.equal(symbol.children.length, file.shapes.length);
		assert.deepEqual(symbol.children.filter((child) => child.kind === "pin").map(({ name }) => name),
			file.shapes.filter((child) => child.kind === "pin").map(({ name }) => name));
		assert.equal(symbol.attributes.reference, `${file.prefix}${index + 1}`);
		assert.equal(symbol.attributes.value, file.value);
	}
});
