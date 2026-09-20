import assert from "node:assert/strict";
import { test } from "node:test";
import { drawShape, moveShapes, resizeHandles, resizeShape, snapPoint } from "../src/components/editor/shapes.ts";

import { rulerSpacing, rulerTicks } from "../src/engine/ruler.ts";

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

test("snapping uses the visible grid spacing at different zoom levels and signed coordinates", () => {
	for (const scale of [0.01, 0.8, 8, 80, 800, 8000]) {
		const { minor } = rulerSpacing(scale);
		const ticks = rulerTicks(0, scale, 800);
		close(ticks[1].value - ticks[0].value, minor);
		assert.deepEqual(snapPoint({ x: -3.2 * minor, y: 2.3 * minor }, minor), { x: Number((-3 * minor).toPrecision(12)), y: Number((2 * minor).toPrecision(12)) });
	}
});

test("snapped drawing aligns corners, line endpoints, and circle radii", () => {
	for (const kind of ["rectangle", "triangle", "line", "circle"] as const) {
		const shape = drawShape(1, kind, { x: -43, y: -37 }, { x: 23, y: 32 }, 10);
		if (kind === "circle") {
			close(shape.x, -40);
			close(shape.y, -40);
			close(shape.width, 200);
		} else if (kind === "line") {
			const handles = resizeHandles(shape);
			close(handles[0].x, -40);
			close(handles[0].y, -40);
			close(handles[1].x, 20);
			close(handles[1].y, 30);
		} else {
			close(shape.width, 60);
			close(shape.height, 70);
			close(shape.x, -10);
			close(shape.y, -5);
		}
	}
});

test("snapped resizing fixes the opposite side and rounds circle radii", () => {
	for (const kind of ["rectangle", "triangle", "line", "circle"] as const) {
		const original = drawShape(1, kind, { x: 0, y: 0 }, { x: 30, y: 40 }, 10);
		const handle = resizeHandles(original).find((handle) => handle.id === (kind === "rectangle" || kind === "triangle" ? "1,1" : "1,0"))!;
		const resized = resizeShape(original, handle, { x: 13, y: 17 }, 10);
		if (kind === "circle") {
			close(resized.width, 140);
			close(resized.x, 0);
			close(resized.y, 0);
		} else {
			const handles = resizeHandles(resized);
			close(handles[0].x, 0);
			close(handles[0].y, 0);
			const end = handles.find((item) => item.id === handle.id)!;
			close(end.x, 40);
			close(end.y, 60);
		}
	}
});

test("group moves snap the grabbed shape's anchor and preserve relative positions", () => {
	const rectangle = drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 30, y: 50 });
	const circle = drawShape(2, "circle", { x: 63, y: 17 }, { x: 78, y: 17 });
	const originals = [rectangle, circle];
	const moved = moveShapes(originals, { x: 13, y: -9 }, 10, circle);
	close(moved[1].x, 80);
	close(moved[1].y, 10);
	close(moved[1].x - moved[0].x, circle.x - rectangle.x);
	close(moved[1].y - moved[0].y, circle.y - rectangle.y);
	const movedRectangle = moveShapes([rectangle], { x: 13, y: 9 }, 10)[0];
	close(movedRectangle.x - movedRectangle.width / 2, 10);
	close(movedRectangle.y - movedRectangle.height / 2, 10);
	close(movedRectangle.width, rectangle.width);
});
