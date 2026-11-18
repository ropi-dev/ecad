import assert from "node:assert/strict";
import { test } from "node:test";
import { compilePlanarGeometry } from "#/engine/planar-geometry.ts";
import {
	compilePart,
	layoutParts,
	type PlacedPart,
} from "#/engine/planar-parts.ts";
import type { Geometry, Matrix } from "#/engine/types.ts";
import { required } from "./helpers/required.ts";

const segment: Geometry = {
	type: "line",
	x1: -1,
	y1: 0,
	x2: 1,
	y2: 0,
	width: 0.5,
};
const strokedPath: Geometry = {
	type: "path",
	d: "M-1 0L1 0",
	fill: false,
	strokeWidth: 0.5,
};
const pad: Geometry = { type: "rect", x: 0, y: 0, width: 1.5, height: 1 };
const hole: Geometry = { type: "circle", x: 0, y: 0, radius: 0.3 };
const at = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const placed = (geometry: Geometry, transform?: Matrix): PlacedPart => ({
	mesh: compilePart(geometry),
	transform,
});

function area(corners: Float32Array, size: number) {
	let total = 0;
	for (let index = 0; index < corners.length; index += 3 * size) {
		const [ax, ay] = [corners[index], corners[index + 1]];
		const [bx, by] = [corners[index + size], corners[index + size + 1]];
		const [cx, cy] = [corners[index + 2 * size], corners[index + 2 * size + 1]];
		total += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
	}
	return total;
}

function extent(corners: Float32Array, size: number) {
	const xs: number[] = [];
	const ys: number[] = [];
	for (let index = 0; index < corners.length; index += size) {
		xs.push(corners[index]);
		ys.push(corners[index + 1]);
	}
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

test("a track segment compiles to a round-ended strip as wide as the track, matching the stroked path it replaces", () => {
	const { triangles, edges } = compilePart(segment);
	const expected = 2 * 0.5 + Math.PI * 0.25 ** 2;
	assert.ok(Math.abs(area(triangles, 2) - expected) < 0.002);
	for (const [index, bound] of [-1.25, -0.25, 1.25, 0.25].entries())
		assert.ok(Math.abs(extent(triangles, 2)[index] - bound) < 1e-3);
	assert.equal(edges.length % 4, 0);
	assert.deepEqual(
		[edges[edges.length - 2], edges[edges.length - 1]],
		[edges[0], edges[1]],
	);
	const stroked = compilePlanarGeometry([
		{
			id: "stroke",
			geometry: strokedPath,
			bounds: { minX: -1.25, minY: -0.25, maxX: 1.25, maxY: 0.25 },
			polarity: "dark",
			attributes: {},
		},
	]);
	assert.ok(Math.abs(area(stroked.positions, 3) - area(triangles, 2)) < 0.002);
});

test("a rectangle outline is its four edges, and a filled one adds the area inside", () => {
	const edge = (x1: number, y1: number, x2: number, y2: number) => ({
		geometry: { type: "line" as const, x1, y1, x2, y2, width: 0.2 },
		polarity: "dark" as const,
	});
	const outline: Geometry = {
		type: "group",
		children: [
			edge(-2, -1, 2, -1),
			edge(2, -1, 2, 1),
			edge(2, 1, -2, 1),
			edge(-2, 1, -2, -1),
		],
	};
	const part = compilePart(outline);
	const line = compilePart(outline.children[0].geometry);
	assert.equal(part.triangles.length, 2 * 2 * line.triangles.length);
	assert.equal(part.edges.length, 2 * 2 * line.edges.length);
	for (const [index, bound] of [-2.1, -1.1, 2.1, 1.1].entries())
		assert.ok(Math.abs(extent(part.triangles, 2)[index] - bound) < 1e-3);
	const filled = compilePart({
		type: "group",
		children: [{ geometry: pad, polarity: "dark" }, ...outline.children],
	});
	assert.equal(
		filled.triangles.length,
		part.triangles.length + compilePart(pad).triangles.length,
	);
});

test("a circle outline is a ring with a hole, as the resolved cutout would be", () => {
	const ring: Geometry = {
		type: "group",
		children: [
			{ geometry: { ...hole, radius: 1.1 }, polarity: "dark" },
			{ geometry: { ...hole, radius: 0.9 }, polarity: "clear" },
		],
	};
	const part = compilePart(ring);
	const expected = Math.PI * (1.1 ** 2 - 0.9 ** 2);
	assert.ok(Math.abs(area(part.triangles, 2) - expected) < 0.005);
	const resolved = compilePlanarGeometry([
		{
			id: "ring",
			geometry: ring,
			bounds: { minX: -1.1, minY: -1.1, maxX: 1.1, maxY: 1.1 },
			polarity: "dark",
			attributes: {},
		},
	]);
	assert.ok(
		Math.abs(area(resolved.positions, 3) - area(part.triangles, 2)) < 0.005,
	);
	const radii = new Set<number>();
	for (let index = 0; index < part.edges.length; index += 2)
		radii.add(
			Math.round(Math.hypot(part.edges[index], part.edges[index + 1]) * 1e4) /
				1e4,
		);
	assert.deepEqual([...radii].sort(), [0.9, 1.1]);
	const offCentre = compilePart({
		type: "group",
		children: [
			{ geometry: { ...hole, radius: 1.1 }, polarity: "dark" },
			{ geometry: { ...hole, x: 0.1, radius: 0.5 }, polarity: "clear" },
		],
	});
	assert.ok(
		Math.abs(area(offCentre.triangles, 2) - Math.PI * (1.1 ** 2 - 0.5 ** 2)) <
			0.005,
	);
});

test("moving one item rewrites its copper and walls in a layer and leaves its neighbours alone", () => {
	const parts = [
		placed(pad, at(-3, 0)),
		placed(segment, at(0, 0)),
		placed(pad, at(3, 0)),
	];
	const layout = layoutParts(parts, "slab");
	const untouched = layout.positions.slice();
	const moved = placed(segment, [0, 1, -1, 0, 0.5, 2]);
	assert.equal(layout.fits(1, moved.mesh), true);
	assert.equal(layout.fits(1, placed(pad).mesh), false);
	layout.replace(1, moved);
	const fresh = layoutParts([parts[0], moved, parts[2]], "slab");
	assert.deepEqual(layout.positions, fresh.positions);
	assert.deepEqual(layout.edges, fresh.edges);
	assert.deepEqual(layout.walls?.positions, fresh.walls?.positions);
	const changes = layout.takeChanges();
	const padCorners = parts[0].mesh.triangles.length / 2;
	const trackCorners = moved.mesh.triangles.length / 2;
	assert.deepEqual(changes.positions, [
		padCorners * 3,
		(padCorners + trackCorners) * 3,
	]);
	const [start, end] = required(changes.positions);
	assert.deepEqual(layout.positions.slice(0, start), untouched.slice(0, start));
	assert.deepEqual(layout.positions.slice(end), untouched.slice(end));
	const left = required(changes.vacated);
	for (const [index, bound] of [-1.25, -0.25, 1.25, 0.25].entries())
		assert.ok(
			Math.abs([left.minX, left.minY, left.maxX, left.maxY][index] - bound) <
				1e-3,
		);
	assert.deepEqual(layout.takeChanges(), {
		positions: undefined,
		walls: undefined,
		vacated: undefined,
	});
});
