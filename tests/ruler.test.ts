import assert from "node:assert/strict";
import { test } from "node:test";
import { gridTicks, rulerSpacing, rulerTicks } from "#/engine/ruler.ts";

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
