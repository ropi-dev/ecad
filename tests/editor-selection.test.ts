import assert from "node:assert/strict";
import { test } from "node:test";
import {
	containsSelection,
	drawShape,
	intersectsSelection,
	shapeBounds,
	symbolTextShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";

test("window selection requires the whole shape, with inclusive edges", () => {
	const shape = drawShape(1, "rectangle", { x: 10, y: 20 }, { x: 30, y: 40 });
	const bounds = { minX: 5, maxX: 20, minY: 15, maxY: 45 };
	assert.equal(containsSelection(shape, bounds), false);
	assert.equal(intersectsSelection(shape, bounds), true);
	assert.equal(containsSelection(shape, shapeBounds(shape)), true);
	assert.equal(
		containsSelection(shape, { ...shapeBounds(shape), minY: 21 }),
		false,
	);
});

test("window selection accounts for rotated lines and circular bounds", () => {
	const line = drawShape(1, "line", { x: 10, y: 20 }, { x: 30, y: 40 });
	assert.equal(
		containsSelection(line, { minX: 9, maxX: 31, minY: 19, maxY: 41 }),
		true,
	);
	assert.equal(
		containsSelection(line, { minX: 15, maxX: 25, minY: 15, maxY: 45 }),
		false,
	);
	const circle = {
		...drawShape(2, "circle", { x: 20, y: 30 }, { x: 25, y: 30 }),
		rotation: Math.PI / 4,
	};
	assert.equal(
		containsSelection(circle, { minX: 15, maxX: 25, minY: 25, maxY: 35 }),
		true,
	);
});

test("window selection includes all symbol labels at every quarter turn", () => {
	const original = createSymbol(1, symbolDefinitions[0], { x: 50, y: 60 });
	original.attributes.reference = "R_LONG_REFERENCE";
	for (const rotation of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
		const symbol = { ...original, rotation };
		const body = shapeBounds(symbol);
		assert.equal(containsSelection(symbol, body), false);
		const parts = [body, ...symbolTextShapes(symbol).map(shapeBounds)];
		const full = {
			minX: Math.min(...parts.map((part) => part.minX)),
			maxX: Math.max(...parts.map((part) => part.maxX)),
			minY: Math.min(...parts.map((part) => part.minY)),
			maxY: Math.max(...parts.map((part) => part.maxY)),
		};
		assert.equal(containsSelection(symbol, full), true);
		const label = symbolTextShapes(symbol)[0];
		const touch = {
			minX: label.x,
			maxX: label.x,
			minY: label.y,
			maxY: label.y,
		};
		assert.equal(intersectsSelection(symbol, touch), true);
		assert.equal(containsSelection(symbol, touch), false);
	}
});
