import assert from "node:assert/strict";
import test from "node:test";
import { drawShape } from "#/drawing/shapes.ts";
import { createSymbolFromShapes } from "#/drawing/symbols.ts";
import { validateProjectDocument } from "#/projects/format.ts";

test("project drawings preserve pin names and text numbers, including symbol children", () => {
	const pin = { ...drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 }), kind: "pin" as const, name: "VCC", number: "01" };
	const symbol = createSymbolFromShapes(2, [{ ...pin, number: "A1" }]);
	const document = { shapes: [pin, symbol], symbols: [] };
	assert.deepEqual(validateProjectDocument(JSON.parse(JSON.stringify(document))), document);
	assert.throws(() => validateProjectDocument(JSON.parse(JSON.stringify({ ...document, shapes: [{ ...pin, number: 1 }] }))), /number/);
});

test("project drawings restore legacy pins without names or numbers", () => {
	const pin = drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
	if (pin.kind !== "pin") throw new Error("Expected a pin");
	const { name: _name, number: _number, ...legacy } = pin;
	assert.deepEqual(validateProjectDocument({ shapes: [legacy as typeof pin], symbols: [] }).shapes, [pin]);
});
