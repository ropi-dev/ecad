import assert from "node:assert/strict";
import { test } from "node:test";
import {
	containsSelection,
	drawShape,
	intersectsSelection,
	shapeBounds,
} from "@ecad/drawing-core/drawing/shapes.ts";

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
