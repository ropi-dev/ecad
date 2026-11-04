import assert from "node:assert/strict";
import { test } from "node:test";
import { gridTicks, rulerSpacing, rulerTicks } from "#/engine/ruler.ts";
import { required } from "./helpers/required.ts";

test("rulers place signed coordinates and reverse the vertical axis", () => {
	const horizontal = rulerTicks(10, 5, 400);
	assert.equal(horizontal.find((tick) => tick.value === 0)?.position, 150);
	assert.equal(horizontal.find((tick) => tick.value === 20)?.position, 250);
	assert.equal(horizontal.find((tick) => tick.value === -20)?.position, 50);
	assert.equal(horizontal.find((tick) => tick.value === -30)?.position, 0);
	assert.equal(
		gridTicks(10, 5, 400).find((tick) => tick.value === -30)?.position,
		0,
	);
	const vertical = rulerTicks(10, 5, 400, true);
	assert.equal(vertical.find((tick) => tick.value === 0)?.position, 250);
	assert.equal(vertical.find((tick) => tick.value === 20)?.position, 150);
});

test("ruler labels remain readable from submillimetre to board overview scales", () => {
	for (const scale of [0.01, 0.8, 8, 80, 800, 8000]) {
		const ticks = rulerTicks(0, scale, 800);
		const labels = ticks.filter((tick) => tick.label !== undefined);
		assert.ok(labels.length >= 1);
		assert.ok(ticks.length <= 101);
		for (let index = 1; index < labels.length; index++) {
			assert.ok(labels[index].position - labels[index - 1].position >= 99.99);
			assert.equal(
				Number(labels[index].label),
				Number(labels[index].value.toPrecision(12)),
			);
		}
		assert.ok(
			!labels.some((tick) => tick.label?.startsWith("-0") && tick.value === 0),
		);
	}
	assert.equal(
		rulerTicks(0, 2500, 800).find((tick) => tick.value === 0.1)?.label,
		"0.1",
	);
});

test("invalid or unmeasured viewports have no ruler ticks", () => {
	for (const scale of [0, -1, NaN, Infinity]) {
		assert.deepEqual(rulerTicks(0, scale, 800), []);
		assert.deepEqual(gridTicks(0, scale, 800), []);
	}
	assert.deepEqual(rulerTicks(0, 10, 0), []);
	assert.deepEqual(gridTicks(0, 10, 0), []);
});

test("grid crossfades unique lines while shared lines retain their strength", () => {
	const ticks = gridTicks(0, 10, 6000);
	const tickAt = (value: number) =>
		required(ticks.find((tick) => tick.value === value));
	assert.equal(new Set(ticks.map((tick) => tick.value)).size, ticks.length);
	for (const value of [-5, -1, 1, 5])
		assert.ok(Math.abs(tickAt(value).opacity - 0.5) < 1e-10);
	for (const value of [-100, -50, -20, -2, 0, 2, 20, 50, 100])
		assert.equal(tickAt(value).opacity, 1);
	assert.equal(tickAt(0).majorOpacity, 1);
	assert.equal(tickAt(20).majorOpacity, 1);
	assert.ok(Math.abs(tickAt(50).majorOpacity - 0.5) < 1e-10);
	assert.equal(tickAt(100).majorOpacity, 1);
	const earlyFineLine = required(
		gridTicks(0, 9, 997).find((tick) => tick.value === 1),
	);
	assert.ok(earlyFineLine.opacity > 0 && earlyFineLine.opacity < 0.5);
	assert.equal(rulerSpacing(9).minor, 2);
	assert.equal(rulerSpacing(10).minor, 1);
});

test("grid appearance stays continuous across the discrete snapping cutoff", () => {
	for (const cutoff of [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50]) {
		const beforeScale = cutoff * (1 - 1e-8);
		const afterScale = cutoff * (1 + 1e-8);
		const before = gridTicks(0, beforeScale, 997);
		const after = gridTicks(0, afterScale, 997);
		assert.notEqual(
			rulerSpacing(beforeScale).minor,
			rulerSpacing(afterScale).minor,
		);
		assert.equal(before.length, after.length);
		for (const [index, tick] of before.entries()) {
			assert.equal(tick.value, after[index].value);
			assert.ok(Math.abs(tick.opacity - after[index].opacity) < 1e-6);
			assert.ok(Math.abs(tick.majorOpacity - after[index].majorOpacity) < 1e-6);
		}
		for (const factor of [0.87, 1.13]) {
			const scale = cutoff * factor;
			const settled = gridTicks(0, scale, 997);
			assert.deepEqual(
				settled.map((tick) => tick.value),
				rulerTicks(0, scale, 997).map((tick) => tick.value),
			);
			assert.ok(settled.every((tick) => tick.opacity === 1));
		}
	}
});

test("grid spacing repeats its intermediate steps at every decade", () => {
	assert.deepEqual(
		[0.04, 0.4, 4, 40, 400, 4000].map((scale) => rulerSpacing(scale).major),
		[10000, 1000, 100, 10, 1, 0.1],
	);
	for (const scale of [0.01, 0.8, 8, 80, 800, 8000]) {
		const current = rulerSpacing(scale);
		assert.equal(rulerSpacing(scale * 10).major, current.major / 10);
		assert.equal(rulerSpacing(scale / 10).minor, current.minor * 10);
	}
});

test("each major grid square has ten subdivisions at every zoom", () => {
	assert.deepEqual(rulerSpacing(4), { major: 100, minor: 10 });
	for (const scale of [0.01, 0.8, 8, 80, 800, 8000]) {
		const { major, minor } = rulerSpacing(scale);
		assert.ok(Math.abs(major / minor - 10) < 1e-10);
		const ticks = rulerTicks(0, scale, 800);
		const labelled = ticks.flatMap((tick, index) =>
			tick.label === undefined ? [] : [index],
		);
		for (let index = 1; index < labelled.length; index++)
			assert.equal(labelled[index] - labelled[index - 1], 10);
	}
});

test("minor grid spacing stays between 10 and 50 pixels across zoom levels", () => {
	for (let step = -600; step <= 600; step++) {
		const scale = 10 ** (step / 100);
		const pixels = rulerSpacing(scale).minor * scale;
		assert.ok(
			pixels >= 10 - 1e-10 && pixels <= 50 + 1e-10,
			`${pixels} px at scale ${scale}`,
		);
	}
	assert.equal(rulerSpacing(4.99).minor, 10);
	assert.equal(rulerSpacing(5).minor, 2);
	assert.equal(rulerSpacing(9.99).minor, 2);
	assert.equal(rulerSpacing(10).minor, 1);
});
