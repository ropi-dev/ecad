import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlanarGeometry } from "#/engine/planar-geometry.ts";
import { createHoleMask, type HoleMask } from "#/engine/planar-holes.ts";
import {
	compilePart,
	layoutParts,
	type PlacedPart,
} from "#/engine/planar-parts.ts";
import { required } from "./helpers/required.ts";

const drill = compilePart({ type: "circle", x: 0, y: 0, radius: 0.5 });
const at = (x: number, y: number): PlacedPart => ({
	mesh: drill,
	transform: [1, 0, 0, 1, x, y],
});

const pixels = (mask: HoleMask) =>
	(mask.texture.image as { data: Uint8Array }).data;

function drilledBoard() {
	const layout = layoutParts([at(-10, 0), at(0, 0), at(10, 4)], "barrel", 0.07);
	const drills: PlanarGeometry = {
		positions: layout.positions,
		edges: layout.edges,
		regions: [],
	};
	const canvas = { reads: [] as { width: number; height: number }[] };
	const mask = required(
		createHoleMask([drills], (width, height) =>
			canvas.reads.push({ width, height }),
		),
	);
	return { layout, drills, canvas, mask };
}

test("a moved drill takes its hole with it, and only the area it left and entered is repainted", () => {
	const { layout, drills, canvas, mask } = drilledBoard();
	assert.deepEqual(
		[
			[-10, 0],
			[0, 0],
			[10, 4],
			[0, 2],
			[5, 0],
		].map(([x, y]) => mask.contains(x, y)),
		[true, true, true, false, false],
	);
	const whole = required(canvas.reads.at(-1));
	assert.equal(mask.repaint([drills]), true);
	assert.equal(canvas.reads.length, 1);

	layout.replace(1, at(1.5, 2));
	const uploaded = mask.texture.version;
	assert.equal(mask.repaint([drills]), true);
	assert.deepEqual(
		[
			[-10, 0],
			[0, 0],
			[1.5, 2],
			[10, 4],
		].map(([x, y]) => mask.contains(x, y)),
		[true, false, true, true],
	);
	assert.ok(mask.texture.version > uploaded);
	const repainted = required(canvas.reads.at(-1));
	assert.ok(
		repainted.width * repainted.height < (whole.width * whole.height) / 10,
	);

	const fresh = required(createHoleMask([drills]));
	assert.deepEqual(mask.bounds, fresh.bounds);
	assert.deepEqual(pixels(mask), pixels(fresh));
});

test("a drill dragged past the mask's edge asks for a new mask and leaves this one as it was", () => {
	const { layout, drills, canvas, mask } = drilledBoard();
	const before = pixels(mask).slice();
	layout.replace(1, at(0, 30));
	assert.equal(mask.repaint([drills]), false);
	assert.equal(canvas.reads.length, 1);
	assert.deepEqual(pixels(mask), before);
	assert.equal(mask.contains(0, 0), true);
	layout.replace(1, at(2, 1));
	assert.equal(mask.repaint([drills]), true);
	assert.deepEqual([mask.contains(0, 0), mask.contains(2, 1)], [false, true]);
});

test("a board that gains or loses a drill needs a new mask", () => {
	const { drills, mask } = drilledBoard();
	const more = layoutParts([at(-10, 0), at(0, 0), at(10, 4), at(3, 3)]);
	assert.equal(mask.repaint([{ ...drills, edges: more.edges }]), false);
	assert.equal(mask.repaint([drills, drills]), false);
	assert.equal(mask.repaint([drills]), true);
});

test("a drill moved onto, into and off one that stays repaints the same mask a new build paints", () => {
	const small: PlacedPart = {
		mesh: drill,
		transform: [0.3, 0, 0, 0.3, 6, 0],
	};
	const layout = layoutParts(
		[at(0, 0), small, at(-12, 3), at(12, -3)],
		"barrel",
		0.07,
	);
	const drills: PlanarGeometry = {
		positions: layout.positions,
		edges: layout.edges,
		regions: [],
	};
	const mask = required(createHoleMask([drills]));
	for (const [x, y] of [
		[0.9, 0],
		[0.45, 0.1],
		[0, 0],
		[0.62, 0],
		[6, 0],
	]) {
		layout.replace(1, { ...small, transform: [0.3, 0, 0, 0.3, x, y] });
		assert.equal(mask.repaint([drills]), true);
		const fresh = required(createHoleMask([drills]));
		assert.deepEqual(mask.bounds, fresh.bounds);
		assert.deepEqual(pixels(mask), pixels(fresh), `small drill at ${x}, ${y}`);
	}
});

test("overlapping drills cut one hole between them", () => {
	const layout = layoutParts([at(0, 0), at(0.6, 0), at(40, 0)]);
	const mask = required(
		createHoleMask([
			{ positions: layout.positions, edges: layout.edges, regions: [] },
		]),
	);
	assert.deepEqual(
		[mask.contains(0.3, 0), mask.contains(-0.3, 0), mask.contains(0.9, 0)],
		[true, true, true],
	);
});
