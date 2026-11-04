import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { exportDrawingSvg } from "#/drawing/export.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import {
	drawShape,
	hitShape,
	moveShapes,
	openPins,
	pinTerminals,
	symbolShapes,
} from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
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

test("no-connect symbol children suppress transformed terminal halos and honor overrides", () => {
	const pin = drawShape(1, "pin", { x: 3, y: 4 }, { x: 3, y: 4 });
	const marker = drawShape(2, "no-connect", pin, pin);
	const definition = {
		...symbolDefinitions[0],
		children: [pin, marker],
		texts: [],
	};
	for (const rotation of [0, Math.PI / 2, Math.PI / 3]) {
		const symbol = {
			...createSymbol(10, definition, { x: 20, y: 30 }),
			rotation,
		};
		assert.equal(openPins([symbol]).length, 0);
		assert.equal(buildDrawingDisplay([symbol], new Set()).halos.length, 0);
		const withoutMarker = { ...symbol, children: [pin] };
		assert.equal(openPins([withoutMarker]).length, 1);
		const overridden = { ...symbol, childOverrides: { "shape:2": { x: 10 } } };
		assert.equal(openPins([overridden]).length, 1);
		const terminal = pinTerminals(symbol)[0];
		assert.equal(
			openPins([symbol], { point: terminal, tolerance: 0.1 }).length,
			0,
		);
		const worldMarker = required(
			symbolShapes(symbol).find((shape) => shape.kind === "no-connect"),
		);
		assert.ok(
			Math.hypot(worldMarker.x - terminal.x, worldMarker.y - terminal.y) < 1e-9,
		);
	}
});

test("no-connect movement snaps the terminal center for keyboard and drag deltas", () => {
	const marker = drawShape(1, "no-connect", { x: 0, y: 0 }, { x: 0, y: 0 });
	for (const [dx, dy, x, y] of [
		[1.27, 0, 1.27, 0],
		[-1.27, 0, -1.27, 0],
		[0, 1.27, 0, 1.27],
		[0, -1.27, 0, -1.27],
		[1.4, 2.4, 1.27, 2.54],
	]) {
		const [moved] = moveShapes([marker], { x: dx, y: dy }, 1.27);
		assert.ok(Math.abs(moved.x - x) < 1e-9);
		assert.ok(Math.abs(moved.y - y) < 1e-9);
		const pin = drawShape(2, "pin", { x, y }, { x, y });
		assert.equal(openPins([pin, moved]).length, 0);
	}
});
