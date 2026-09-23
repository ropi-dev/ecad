import assert from "node:assert/strict";
import { test } from "node:test";
import { rulerSpacing, rulerTicks } from "../src/engine/ruler";

test("rulers place signed coordinates and reverse the vertical axis", () => {
	const horizontal = rulerTicks(10, 10, 400);
	assert.equal(horizontal.find((tick) => tick.value === 0)?.position, 100);
	assert.equal(horizontal.find((tick) => tick.value === 20)?.position, 300);
	assert.equal(horizontal.find((tick) => tick.value === -4)?.position, 60);
	const vertical = rulerTicks(10, 10, 400, true);
	assert.equal(vertical.find((tick) => tick.value === 0)?.position, 300);
	assert.equal(vertical.find((tick) => tick.value === 20)?.position, 100);
});

test("ruler labels remain readable from submillimetre to board overview scales", () => {
	for (const scale of [0.01, 0.8, 8, 80, 800, 8000]) {
		const ticks = rulerTicks(0, scale, 800);
		const labels = ticks.filter((tick) => tick.label !== undefined);
		assert.ok(labels.length >= 2);
		assert.ok(ticks.length <= 101);
		for (let index = 1; index < labels.length; index++) {
			assert.ok(labels[index].position - labels[index - 1].position >= 249.99);
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
		rulerTicks(0, 800, 800).find((tick) => tick.value === 0.4)?.label,
		"0.4",
	);
});

test("invalid or unmeasured viewports have no ruler ticks", () => {
	for (const scale of [0, -1, NaN, Infinity])
		assert.deepEqual(rulerTicks(0, scale, 800), []);
	assert.deepEqual(rulerTicks(0, 10, 0), []);
});


test("each major grid square has ten subdivisions at every zoom", () => {
 assert.deepEqual(rulerSpacing(4), { major: 100, minor: 10 });
 for (const scale of [0.01, 0.8, 8, 80, 800, 8000]) {
  const { major, minor } = rulerSpacing(scale);
  assert.ok(Math.abs(major / minor - 10) < 1e-10);
  const ticks = rulerTicks(0, scale, 800);
  const labelled = ticks.flatMap((tick, index) => tick.label === undefined ? [] : [index]);
  for (let index = 1; index < labelled.length; index++) assert.equal(labelled[index] - labelled[index - 1], 10);
 }
});
