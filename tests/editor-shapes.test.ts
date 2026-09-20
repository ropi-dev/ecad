import assert from "node:assert/strict";
import { test } from "node:test";
import { drawShape, resizeHandles, resizeShape } from "../src/components/editor/shapes.ts";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("rotated corner resizing anchors the opposite corner and clamps dimensions above zero", () => {
	const original = { ...drawShape(1, "rectangle", { x: 10, y: 20 }, { x: 50, y: 40 }), rotation: Math.PI / 3 };
	const handle = resizeHandles(original).find((handle) => handle.id === "1,1")!;
	const fixed = resizeHandles(original).find((handle) => handle.id === "-1,-1")!;
	for (const delta of [{ x: 15, y: 30 }, { x: -1000, y: -1000 }]) {
		const resized = resizeShape(original, handle, delta);
		const anchor = resizeHandles(resized).find((handle) => handle.id === "-1,-1")!;
		close(anchor.x, fixed.x);
		close(anchor.y, fixed.y);
		assert.ok(resized.width >= 0.1 && resized.height >= 0.1);
		close(resized.rotation, original.rotation);
	}
});

test("circle resizing keeps its center and diameter consistent", () => {
	const original = drawShape(1, "circle", { x: 10, y: 20 }, { x: 25, y: 20 });
	const handle = resizeHandles(original).find((handle) => handle.id === "1,0")!;
	const resized = resizeShape(original, handle, { x: 15, y: 40 });
	close(resized.width, 100);
	close(resized.height, 100);
	close(resized.x, 10);
	close(resized.y, 20);
	const collapsed = resizeShape(original, handle, { x: -15, y: 0 });
	close(collapsed.width, 0.1);
});

test("either line endpoint can pass its opposite endpoint without moving the anchor", () => {
	const original = drawShape(1, "line", { x: 10, y: 20 }, { x: 40, y: 60 });
	for (const handle of resizeHandles(original)) {
		const fixed = resizeHandles(original).find((other) => other.id !== handle.id)!;
		const resized = resizeShape(original, handle, { x: 2 * (fixed.x - handle.x), y: 2 * (fixed.y - handle.y) });
		const anchor = resizeHandles(resized).find((other) => other.id === fixed.id)!;
		close(anchor.x, fixed.x);
		close(anchor.y, fixed.y);
		close(resized.width, 50);
		close(resized.height, 1);
	}
});

test("collapsing a line keeps a minimum length at its fixed endpoint", () => {
	const original = drawShape(1, "line", { x: 10, y: 20 }, { x: 40, y: 60 });
	const handle = resizeHandles(original).find((handle) => handle.id === "1,0")!;
	const resized = resizeShape(original, handle, { x: -30, y: -40 });
	close(resized.width, 0.1);
	const anchor = resizeHandles(resized).find((handle) => handle.id === "-1,0")!;
	close(anchor.x, 10);
	close(anchor.y, 20);
});
