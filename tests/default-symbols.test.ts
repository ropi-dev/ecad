import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDefaultSymbols } from "@ecad/default-symbols";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";

test("every generated default is valid portable geometry and has a reserved built-in ID", () => {
	for (const { file, texts, category } of generateDefaultSymbols()) {
		assert.throws(() => parseSymbolFile(JSON.stringify(file)), /reserved/);
		const custom = { ...file, id: `custom.${file.id}` };
		assert.deepEqual(parseSymbolFile(JSON.stringify(custom)), custom);
		const definition = libraryDefinitions([file])[0];
		assert.deepEqual(symbolDefinitions.find(({ id }) => id === file.id), { ...definition, texts, category });
		assert.equal(definition.children.filter((shape) => shape.kind === "pin").length,
			file.shapes.filter((shape) => shape.kind === "pin").length);
	}
});
