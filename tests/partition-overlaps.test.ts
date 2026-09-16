import assert from "node:assert/strict";
import test from "node:test";
import { partitionOverlaps } from "#/engine/partition-overlaps";
import type { Bounds } from "#/engine/types";

const box = (x: number, y = 0): Bounds => ({
	minX: x,
	minY: y,
	maxX: x + 1,
	maxY: y + 1,
});

test("overlap groups preserve input order across transitive and touching bounds", () => {
	assert.deepEqual(partitionOverlaps([]), []);
	assert.deepEqual(
		partitionOverlaps([box(2), box(0, 4), box(0), box(1), box(0, 5)]),
		[
			[0, 2, 3],
			[1, 4],
		],
	);
	assert.deepEqual(
		partitionOverlaps(Array.from({ length: 2000 }, () => box(0))),
		[Array.from({ length: 2000 }, (_, index) => index)],
	);
});

test("spatial overlap groups match a brute-force search for scattered bounds", () => {
	let seed = 12345;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	const bounds = Array.from({ length: 500 }, () =>
		box(random() * 40, random() * 40),
	);
	const remaining = new Set(bounds.map((_, index) => index));
	const expected: number[][] = [];
	for (const start of remaining) {
		const group = [start];
		remaining.delete(start);
		for (let cursor = 0; cursor < group.length; cursor++) {
			const a = bounds[group[cursor]];
			for (const index of remaining) {
				const b = bounds[index];
				if (
					a.minX <= b.maxX &&
					a.maxX >= b.minX &&
					a.minY <= b.maxY &&
					a.maxY >= b.minY
				) {
					group.push(index);
					remaining.delete(index);
				}
			}
		}
		expected.push(group.sort((a, b) => a - b));
	}
	assert.deepEqual(partitionOverlaps(bounds), expected);
});
