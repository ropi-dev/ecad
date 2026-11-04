import assert from "node:assert/strict";
import test from "node:test";
import { compilePlanarGeometry } from "#/engine/planar-geometry.ts";
import {
	pickPlanarRegion,
	planarRegionPositions,
} from "#/engine/planar-regions.ts";
import { parseGerber } from "#/formats/gerber/index.ts";
import { required } from "./helpers/required.ts";

const compile = (body: string) => {
	const result = parseGerber(`%FSLAX46Y46*%%MOMM*%${body}M02*`);
	assert.deepEqual(result.diagnostics, []);
	return compilePlanarGeometry(result.object.objects);
};
const area = (vertices: Float32Array) => {
	let result = 0;
	for (let i = 0; i < vertices.length; i += 9)
		result +=
			Math.abs(
				(vertices[i + 3] - vertices[i]) * (vertices[i + 7] - vertices[i + 1]) -
					(vertices[i + 6] - vertices[i]) * (vertices[i + 4] - vertices[i + 1]),
			) / 2;
	return result;
};

test("trace segments, bends, branches and pads share one region without net metadata", () => {
	const geometry = compile(`%ADD10C,0.6*%%ADD11C,2*%
D10*X0Y0D02*X4000000Y0D01*X8000000Y0D01*X8000000Y4000000D01*
X4000000Y0D02*X4000000Y-4000000D01*
D11*X8000000Y4000000D03*X2000000Y3000000D03*`);
	const trace = pickPlanarRegion(geometry, { x: 2, y: 0 }, 0);
	assert.notEqual(trace, undefined);
	for (const point of [
		{ x: 6, y: 0 },
		{ x: 8, y: 2 },
		{ x: 8, y: 4 },
		{ x: 4, y: -3 },
	])
		assert.equal(pickPlanarRegion(geometry, point, 0), trace);
	const isolated = pickPlanarRegion(geometry, { x: 2, y: 3 }, 0);
	assert.notEqual(isolated, undefined);
	assert.notEqual(
		isolated,
		trace,
		"overlapping bounding boxes do not connect separate geometry",
	);
	assert.ok(area(planarRegionPositions(geometry, required(trace))) > 10);
});

test("clear cutouts break connections and leave a nearby island separate", () => {
	const geometry = compile(
		`%ADD10R,8X8*%%ADD11R,1X10*%D10*X0Y0D03*%LPC*%D11*X0Y0D03*`,
	);
	const left = pickPlanarRegion(geometry, { x: -2, y: 0 }, 0);
	const right = pickPlanarRegion(geometry, { x: 2, y: 0 }, 0);
	assert.notEqual(left, undefined);
	assert.notEqual(right, undefined);
	assert.notEqual(left, right);
	assert.equal(pickPlanarRegion(geometry, { x: 0, y: 0 }, 0), undefined);
	assert.equal(area(planarRegionPositions(geometry, required(left))), 28);
	assert.equal(area(planarRegionPositions(geometry, required(right))), 28);
	const ring = compile(
		`%ADD10R,8X8*%%ADD11R,4X4*%%ADD12R,2X2*%D10*X0Y0D03*%LPC*%D11*X0Y0D03*%LPD*%D12*X0Y0D03*`,
	);
	assert.notEqual(
		pickPlanarRegion(ring, { x: 3, y: 0 }, 0),
		pickPlanarRegion(ring, { x: 0, y: 0 }, 0),
	);
	assert.equal(pickPlanarRegion(ring, { x: 1.5, y: 0 }, 0), undefined);
});

test("point-touching shapes connect without merging shapes across a visible gap", () => {
	const geometry = compile(
		`%ADD10R,2X2*%D10*X0Y0D03*X2000000Y2000000D03*X4020000Y2000000D03*`,
	);
	const first = pickPlanarRegion(geometry, { x: 0, y: 0 }, 0);
	assert.notEqual(first, undefined);
	assert.equal(pickPlanarRegion(geometry, { x: 2, y: 2 }, 0), first);
	assert.equal(area(planarRegionPositions(geometry, required(first))), 8);
	assert.notEqual(pickPlanarRegion(geometry, { x: 4.02, y: 2 }, 0), first);
});
