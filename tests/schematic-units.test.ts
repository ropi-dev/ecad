import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatInches,
	formatLength,
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
	assert.equal(formatLength(-2.54, "mil"), "-100 mil");
	assert.equal(formatLength(0.15, "mm"), "0.15 mm");
	for (const value of [-1234.5, 0, 50, 100, 1000]) {
		assert.equal(toMils(fromMils(value)), value);
	}
});

test("schematic rulers and grid share binary subdivisions of 50 mil", () => {
	assert.equal(rulerSpacing(10, "schematic").minor, 1.27);
	for (const scale of [0.1, 1, 10, 100, 1000]) {
		const spacing = rulerSpacing(scale, "schematic");
		assert.ok(spacing.minor * scale >= 10);
		const ticks = rulerTicks(0, scale, 800, false, "schematic");
		for (const tick of ticks.filter((tick) => tick.label !== undefined)) {
			assert.ok(Math.abs(Number(tick.label) * 0.0254 - tick.value) < 1e-8);
		}
		const layers = gridLayers(scale, "schematic");
		assert.ok(
			Math.abs(layers.reduce((sum, layer) => sum + layer.opacity, 0) - 1) <
				1e-8,
		);
		assert.ok(layers.some((layer) => layer.spacing.minor === spacing.minor));
	}
});

test("board mil grid steps through round mil spacings", () => {
	for (const scale of [0.1, 1, 10, 100, 1000, 100000]) {
		const spacing = rulerSpacing(scale, "mil");
		assert.ok(spacing.minor * scale >= 10);
		const mils = toMils(spacing.minor);
		assert.ok(
			[1, 2].includes(
				Number((mils / 10 ** Math.floor(Math.log10(mils))).toFixed(6)),
			),
			`${mils} mil`,
		);
		const ticks = rulerTicks(0, scale, 800, false, "mil");
		for (const tick of ticks.filter((tick) => tick.label !== undefined))
			assert.ok(Math.abs(Number(tick.label) * 0.0254 - tick.value) < 1e-8);
	}
	assert.equal(toMils(rulerSpacing(1000, "mil").minor), 1);
	assert.equal(toMils(rulerSpacing(10, "mil").minor), 100);
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
