import assert from "node:assert/strict";
import { test } from "node:test";
import {
	drawShape,
	type EditorShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { normalizeWireSegments } from "@ecad/drawing-core/drawing/wire-normalization.ts";

test("a pin within tolerance after rounding still splits the wire it touches", () => {
	const wire = drawShape(1, "wire", { x: 1e-4, y: 0 }, { x: 1e-4, y: 10 });
	const pin = {
		...drawShape(2, "pin", { x: 0, y: 5 }, { x: 0, y: 5 }),
		x: -1e-21,
	} as EditorShape;
	const { shapes } = normalizeWireSegments([wire, pin]);
	assert.equal(shapes.filter((shape) => shape.kind === "wire").length, 2);
});

test("wires far from the origin are normalized without hanging", () => {
	const far = {
		...drawShape(1, "wire", { x: 0, y: 0 }, { x: 10, y: 0 }),
		x: 1e18,
	};
	const near = drawShape(2, "wire", { x: 0, y: 0 }, { x: 10, y: 0 });
	const { shapes } = normalizeWireSegments([far, near]);
	assert.equal(shapes.length, 2);
});
