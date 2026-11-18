import assert from "node:assert/strict";
import { test } from "node:test";
import { drawingShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	drawShape,
	hitShape,
	openPins,
	pinTerminals,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { exportDrawingSvg } from "#/drawing/export.ts";
import { createShapeGeometry } from "#/engine/drawing/shapeGeometry.ts";
import { required } from "./helpers/required.ts";

test("no-connect markers survive storage, hide the open-pin halo and do not create terminals", () => {
	const pin = drawShape(1, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
	const marker = drawingShapeSchema.parse(drawShape(2, "no-connect", pin, pin));
	assert.equal(openPins([pin]).length, 1);
	assert.equal(openPins([pin, marker]).length, 0);
	assert.deepEqual(pinTerminals(marker), []);
	assert.ok(hitShape(marker, { x: 0, y: 0 }, 0));
	assert.equal(buildDrawingDisplay([pin, marker], new Set()).halos.length, 0);
	assert.equal(openPins([pin, { ...marker, x: 10 }]).length, 1);
});

test("no-connect geometry draws both diagonals in the editor and SVG export", () => {
	const marker = drawShape(1, "no-connect", { x: 0, y: 0 }, { x: 0, y: 0 });
	const display = buildDrawingDisplay([marker], new Set());
	const geometry = createShapeGeometry(display.shapes[0].geometry);
	try {
		geometry.computeBoundingBox();
		assert.ok(geometry.getAttribute("position").count > 0);
		assert.ok(required(geometry.boundingBox).max.x > 0.5);
		assert.ok(required(geometry.boundingBox).min.y < -0.5);
	} finally {
		geometry.dispose();
	}
	const svg = exportDrawingSvg([marker], {
		width: 800,
		height: 600,
		area: "drawing",
		background: "white",
		sheet: { name: "A4", width: 297, height: 210 },
	});
	assert.match(svg, /<path/);
});
