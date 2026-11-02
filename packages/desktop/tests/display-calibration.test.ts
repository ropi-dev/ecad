import assert from "node:assert/strict";
import { test } from "node:test";
import { cssPixelsPerMm } from "@ecad/core/components/viewer/displayScale.ts";
import { calibrateDisplay, edidDimensions, xrandrDimensions, type DisplayGeometry } from "../src/main/display-calibration.ts";

const display: DisplayGeometry = {
	id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 },
	size: { width: 1920, height: 1080 }, scaleFactor: 2, rotation: 0,
	nativeOrigin: { x: 0, y: 0 },
};

test("100% maps an A3 sheet to physical pixels through OS and browser scaling", () => {
	const calibration = calibrateDisplay(display, 600, 337.5)!;
	assert.equal(calibration.pixelsPerMm, 6.4);
	for (const ratio of [1, 1.25, 2, 3]) {
		const scale = cssPixelsPerMm(calibration, ratio)!;
		assert.equal(420 * scale * ratio / calibration.pixelsPerMm, 420);
		assert.equal(297 * scale * ratio / calibration.pixelsPerMm, 297);
	}
});

test("rotation swaps the physical dimensions", () => {
	assert.deepEqual(calibrateDisplay({ ...display, rotation: 90, size: { width: 1080, height: 1920 } }, 600, 337.5), calibrateDisplay(display, 600, 337.5));
});

test("missing or implausible data falls back without inventing a DPI", () => {
	for (const [width, height] of [[0, 0], [NaN, 300], [600, 600], [1, 1], [Infinity, 300]])
		assert.equal(calibrateDisplay(display, width, height), null);
	assert.equal(cssPixelsPerMm(null, 2), null);
	assert.equal(cssPixelsPerMm({ pixelsPerMm: 0 }, 2), null);
	assert.equal(cssPixelsPerMm({ pixelsPerMm: 6.4 }, 0), null);
});

test("X11 matching uses native origin and resolution, including negative positions", () => {
	const output = "DP-1 connected primary 3840x2160+0+0 (normal left inverted right x axis y axis) 600mm x 338mm\nDP-2 connected 3840x2160-3840+0 (normal left inverted right x axis y axis) 700mm x 394mm\n";
	assert.deepEqual(xrandrDimensions(output, display), [600, 338]);
	assert.deepEqual(xrandrDimensions(output, { ...display, nativeOrigin: { x: -3840, y: 0 } }), [700, 394]);
	assert.equal(xrandrDimensions(output, { ...display, nativeOrigin: undefined }), null);
	assert.equal(xrandrDimensions(output + output, display), null);
});

test("EDID prefers millimeter timing data and rejects corrupt or missing sizes", () => {
	const bytes = new Uint8Array(128);
	bytes.set([0, 255, 255, 255, 255, 255, 255, 0]);
	bytes[21] = 60; bytes[22] = 34;
	const checksum = () => { bytes[127] = 0; bytes[127] = (256 - bytes.reduce((sum, value) => sum + value, 0) % 256) % 256; };
	checksum();
	assert.deepEqual(edidDimensions(bytes), [600, 340]);
	bytes[54] = 1; bytes[66] = 600 & 255; bytes[67] = 338 & 255; bytes[68] = 0x21;
	checksum();
	assert.deepEqual(edidDimensions(bytes), [600, 338]);
	bytes[20]++;
	assert.equal(edidDimensions(bytes), null);
	assert.equal(edidDimensions(new Uint8Array(10)), null);
});
