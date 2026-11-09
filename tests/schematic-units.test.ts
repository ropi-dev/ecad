import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatInches,
	formatMils,
	fromMils,
	toMils,
} from "@ecad/drawing-core/drawing/units.ts";
import { gridLayers, rulerSpacing, rulerTicks } from "#/engine/ruler.ts";
import { required } from "./helpers/required.ts";

test("schematic display units preserve physical dimensions", () => {
	assert.equal(fromMils(1000), 25.4);
	assert.equal(toMils(1.27), 50);
	assert.equal(formatInches(25.4), "1");
	assert.equal(formatMils(-2.54), "-100 mil");
	for (const value of [-1234.5, 0, 50, 100, 1000]) {
		assert.equal(toMils(fromMils(value)), value);
	}
});

test("mil rulers and grid share binary subdivisions of 50 mil", () => {
	assert.equal(rulerSpacing(10, "mil").minor, 1.27);
	for (const scale of [0.1, 1, 10, 100, 1000]) {
		const spacing = rulerSpacing(scale, "mil");
		assert.ok(spacing.minor * scale >= 10);
		const ticks = rulerTicks(0, scale, 800, false, "mil");
		for (const tick of ticks.filter((tick) => tick.label !== undefined)) {
			assert.ok(Math.abs(Number(tick.label) * 0.0254 - tick.value) < 1e-8);
		}
		const layers = gridLayers(scale, "mil");
		assert.ok(
			Math.abs(layers.reduce((sum, layer) => sum + layer.opacity, 0) - 1) <
				1e-8,
		);
		assert.ok(layers.some((layer) => layer.spacing.minor === spacing.minor));
	}
});

test("mil grid never subdivides below 50 mil when zoomed in", () => {
	for (const scale of [10, 50, 100, 1000, 100000]) {
		assert.equal(rulerSpacing(scale, "mil").minor, 1.27);
		assert.deepEqual(
			gridLayers(scale, "mil").map((layer) => layer.spacing.minor),
			[1.27],
		);
	}
	assert.equal(rulerSpacing(1, "mil").minor, 1.27 * 8);
});

test("new shapes and text use mil-sized defaults", async () => {
	const { drawShape, PIN_RADIUS } = await import(
		"@ecad/drawing-core/drawing/shapes.ts"
	);
	const { createTextShape, pinNameFontSize, pinNumberFontSize } = await import(
		"#/drawing/text.ts"
	);
	for (const kind of [
		"rectangle",
		"circle",
		"triangle",
		"line",
		"wire",
		"pin",
	] as const) {
		const shape = drawShape(
			1,
			kind,
			{ x: 0, y: 0 },
			{ x: fromMils(100), y: fromMils(100) },
		);
		assert.equal(toMils(shape.lineWidth), 5);
		if (shape.kind === "pin") assert.equal(toMils(required(shape.length)), 100);
	}
	const text = createTextShape(2, { x: 0, y: 0 }, (value) => value.length * 48);
	assert.equal(toMils(text.fontSize), 75);
	assert.equal(toMils(text.lineWidth), 5);
	assert.equal(toMils(PIN_RADIUS), 10);
	assert.equal(toMils(pinNameFontSize), 75);
	assert.equal(toMils(pinNumberFontSize), 50);
});

test("built-in annotation sizes and symbol labels use round mil dimensions", async () => {
	const { generateDefaultSymbols } = await import("@ecad/default-symbols");
	const symbols = generateDefaultSymbols();
	const box = required(symbols.find(({ file }) => file.id === "box")).file;
	const border = required(
		box.shapes.find((shape) => shape.kind === "rectangle"),
	);
	assert.equal(border.kind, "rectangle");
	if (border.kind !== "rectangle") throw new Error("Expected a rectangle");
	assert.equal(toMils(border.width), 1000);
	assert.equal(toMils(border.height), 600);
	assert.equal(toMils(required(border.lineWidth)), 5);
	const text = required(box.shapes.find((shape) => shape.kind === "text"));
	assert.equal(text.kind, "text");
	if (text.kind !== "text") throw new Error("Expected text");
	assert.equal(toMils(text.fontSize), 75);
	for (const symbol of symbols) {
		for (const label of symbol.texts) assert.equal(toMils(label.fontSize), 75);
		for (const shape of symbol.file.shapes) {
			if (shape.kind === "pin") {
				assert.ok(
					Math.abs(toMils(shape.x) / 50 - Math.round(toMils(shape.x) / 50)) <
						1e-8,
				);
				assert.ok(
					Math.abs(toMils(shape.y) / 50 - Math.round(toMils(shape.y) / 50)) <
						1e-8,
				);
			}
		}
	}
});
