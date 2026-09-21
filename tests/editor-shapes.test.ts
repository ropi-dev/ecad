import assert from "node:assert/strict";
import { test } from "node:test";
import { constrainLineEndpoint, drawShape, editShapeAttribute, type EditorShape, moveShapes, normalizeLineSegments, resizeHandles, resizeShape, snapPoint } from "../src/components/editor/shapes.ts";

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

test("lines project onto the dominant axis in every direction with horizontal ties", () => {
	const start = { x: 10, y: 20 };
	for (const [x, y, expectedX, expectedY] of [
		[50, 30, 50, 20],
		[-30, 30, -30, 20],
		[20, 60, 10, 60],
		[20, -20, 10, -20],
		[40, 50, 40, 20],
		[-20, -10, -20, 20],
		[10, 20, 10, 20],
	]) {
		const end = { x, y };
		assert.deepEqual(constrainLineEndpoint(start, end), { x: expectedX, y: expectedY });
		const shape = drawShape(1, "line", start, end);
		const [first, last] = resizeHandles(shape);
		close(first.x, start.x);
		close(first.y, start.y);
		close(last.x, expectedX);
		close(last.y, expectedY);
		close(shape.rotation / (Math.PI / 2), Math.round(shape.rotation / (Math.PI / 2)));
		close(shape.height, 1);
	}
});

test("snapping a line endpoint preserves an off-grid start", () => {
	const start = { x: 13, y: -7 };
	assert.deepEqual(constrainLineEndpoint(start, { x: 37, y: 18 }, 10), { x: 40, y: -7 });
	assert.deepEqual(constrainLineEndpoint(start, { x: 24, y: -42 }, 10), { x: 13, y: -40 });
	assert.deepEqual(start, { x: 13, y: -7 });
});

test("either line endpoint can pass its opposite endpoint without moving the anchor", () => {
	for (const end of [{ x: 50, y: 30 }, { x: -30, y: 30 }, { x: 20, y: 60 }, { x: 20, y: -20 }]) {
		const original = drawShape(1, "line", { x: 10, y: 20 }, end);
		for (const handle of resizeHandles(original)) {
			const fixed = resizeHandles(original).find((other) => other.id !== handle.id)!;
			const resized = resizeShape(original, handle, { x: 2 * (fixed.x - handle.x), y: 2 * (fixed.y - handle.y) });
			const anchor = resizeHandles(resized).find((other) => other.id === fixed.id)!;
			close(anchor.x, fixed.x);
			close(anchor.y, fixed.y);
			close(resized.width, 40);
			close(resized.height, 1);
		}
	}
});

test("either line endpoint can collapse onto its anchor before commit normalization", () => {
	for (const end of [{ x: 50, y: 30 }, { x: -30, y: 30 }, { x: 20, y: 60 }, { x: 20, y: -20 }]) {
		const original = drawShape(1, "line", { x: 10, y: 20 }, end);
		for (const handle of resizeHandles(original)) {
			const fixed = resizeHandles(original).find((other) => other.id !== handle.id)!;
			const delta = { x: fixed.x - handle.x, y: fixed.y - handle.y };
			for (const step of [0, 10]) {
				const resized = resizeShape(original, handle, delta, step);
				close(resized.width, 0);
				for (const endpoint of resizeHandles(resized)) {
					close(endpoint.x, fixed.x);
					close(endpoint.y, fixed.y);
				}
				const normalized = normalizeLineSegments([resized]);
				assert.deepEqual(normalized.shapes, []);
				assert.equal(normalized.idMap.size, 0);
			}
		}
	}
});

test("either line endpoint stays orthogonal and anchors the other end during snapped resizing", () => {
	for (const end of [{ x: 53, y: -7 }, { x: 13, y: 33 }]) {
		const original = drawShape(1, "line", { x: 13, y: -7 }, end);
		for (const handle of resizeHandles(original)) {
			const fixed = resizeHandles(original).find((other) => other.id !== handle.id)!;
			for (const target of [{ x: 94, y: 25 }, { x: -48, y: 96 }]) {
				const resized = resizeShape(original, handle, { x: target.x - handle.x, y: target.y - handle.y }, 10);
				const handles = resizeHandles(resized);
				const anchor = handles.find((other) => other.id === fixed.id)!;
				const moved = handles.find((other) => other.id === handle.id)!;
				close(anchor.x, fixed.x);
				close(anchor.y, fixed.y);
				const snapped = snapPoint(target, 10);
				assert.ok(
					Math.abs(moved.x - fixed.x) < 1e-9 && Math.abs(moved.y - snapped.y) < 1e-9 ||
					Math.abs(moved.y - fixed.y) < 1e-9 && Math.abs(moved.x - snapped.x) < 1e-9,
				);
			}
		}
	}
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
			close(handles[1].x, -40);
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
			close(end.x, kind === "line" ? 0 : 40);
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

const segment = (id: number, x1: number, y1: number, x2: number, y2: number) => drawShape(id, "line", { x: x1, y: y1 }, { x: x2, y: y2 });
const endpoints = (shape: EditorShape) => resizeHandles(shape).map(({ x, y }) => ({ x, y }));
function assertSegment(shapes: EditorShape[], id: number, x1: number, y1: number, x2: number, y2: number) {
	const shape = shapes.find((shape) => shape.id === id)!;
	assert.ok(shape, `Missing segment ${id}`);
	const [start, end] = endpoints(shape);
	close(start.x, x1);
	close(start.y, y1);
	close(end.x, x2);
	close(end.y, y2);
}

test("moving a segment stretches attached ends while keeping separate shapes and fixed free ends", () => {
	const first = segment(1, 100, 100, 160, 100);
	const middle = segment(2, 160, 100, 160, 165);
	const last = segment(3, 160, 165, 105, 165);
	const separate = segment(4, 300, 100, 340, 100);
	const rectangle = drawShape(5, "rectangle", { x: 10, y: 10 }, { x: 50, y: 50 });
	const all = [first, middle, last, separate, rectangle];
	const before = structuredClone(all);
	const moved = moveShapes([middle], { x: 30, y: 10 }, 0, middle, all);
	assert.deepEqual(moved.map(({ id }) => id), [2, 1, 3]);
	assertSegment(moved, 1, 100, 110, 190, 110);
	assertSegment(moved, 2, 190, 110, 190, 175);
	assertSegment(moved, 3, 190, 175, 105, 175);
	close(moved[0].width, middle.width);
	assert.deepEqual(all, before);
});

test("axis constraints propagate through branches while body crossings stay independent", () => {
	const trunk = segment(1, 0, 0, 0, 40);
	const branch = segment(2, 0, 40, 30, 40);
	const continuation = segment(3, 30, 40, 60, 40);
	const branchUp = segment(4, 30, 40, 30, 70);
	const crossing = segment(5, 45, 20, 45, 60);
	const moved = moveShapes([trunk], { x: -10, y: 10 }, 0, trunk, [trunk, branch, continuation, branchUp, crossing]);
	assertSegment(moved, 1, -10, 10, -10, 50);
	assertSegment(moved, 2, -10, 50, 30, 50);
	assertSegment(moved, 3, 30, 50, 60, 50);
	assertSegment(moved, 4, 30, 50, 30, 70);
	assert.equal(moved.some(({ id }) => id === crossing.id), false);
});

test("T junction ends follow a selected segment in both axes and constrain a selected branch symmetrically", () => {
	const trunk = segment(1, 0, 0, 100, 0);
	const branch = segment(2, 50, 0, 50, 40);
	const all = [trunk, branch];
	const movedTrunk = moveShapes([trunk], { x: 20, y: 10 }, 0, trunk, all);
	assertSegment(movedTrunk, 1, 20, 10, 120, 10);
	assertSegment(movedTrunk, 2, 70, 10, 70, 40);
	const movedBranch = moveShapes([branch], { x: 20, y: 10 }, 0, branch, all);
	assertSegment(movedBranch, 1, 0, 10, 100, 10);
	assertSegment(movedBranch, 2, 70, 10, 70, 50);
	const detached = moveShapes([branch], { x: 60, y: 10 }, 0, branch, all);
	assert.equal(detached.find(({ id }) => id === trunk.id), trunk);
	assert.equal(detached.find(({ id }) => id === branch.id), branch);
});

test("snapped multi-selection uses one rigid delta for selected shapes and adjusts connected neighbors", () => {
	const first = segment(1, 13, 17, 53, 17);
	const middle = segment(2, 53, 17, 53, 57);
	const last = segment(3, 53, 57, 13, 57);
	const rectangle = drawShape(4, "rectangle", { x: 100, y: 100 }, { x: 120, y: 120 });
	const moved = moveShapes([first, middle, rectangle], { x: 13, y: 13 }, 10, middle, [first, middle, last, rectangle]);
	assert.deepEqual(moved.map(({ id }) => id), [1, 2, 4, 3]);
	assertSegment(moved, 1, 30, 30, 70, 30);
	assertSegment(moved, 2, 70, 30, 70, 70);
	assertSegment(moved, 3, 70, 70, 13, 70);
	close(moved[2].x, rectangle.x + 17);
	close(moved[2].y, rectangle.y + 13);
	close(moved[0].width, first.width);
	close(moved[1].width, middle.width);
});

test("moving one side of a loop preserves every junction without merging its segments", () => {
	const bottom = segment(1, 0, 0, 40, 0);
	const right = segment(2, 40, 0, 40, 30);
	const top = segment(3, 40, 30, 0, 30);
	const left = segment(4, 0, 30, 0, 0);
	const moved = moveShapes([right], { x: 20, y: 10 }, 0, right, [bottom, right, top, left]);
	assert.equal(moved.length, 4);
	assertSegment(moved, 1, 0, 10, 60, 10);
	assertSegment(moved, 2, 60, 10, 60, 40);
	assertSegment(moved, 3, 60, 40, 0, 40);
	assertSegment(moved, 4, 0, 40, 0, 10);
});

test("zero-axis reversals restore originals while raw movement can pass through collapsed edges", () => {
	const first = segment(1, 0, 0, 40, 0);
	const middle = segment(2, 40, 0, 40, 30);
	const last = segment(3, 40, 30, 0, 30);
	const all = [first, middle, last];
	const shifted = moveShapes([middle], { x: 20, y: 10 }, 0, middle, all);
	const reversed = moveShapes([middle], { x: 0, y: 10 }, 0, middle, all);
	assert.equal(shifted.length, reversed.length);
	assertSegment(reversed, 1, 0, 10, 40, 10);
	assertSegment(reversed, 2, 40, 10, 40, 40);
	assertSegment(reversed, 3, 40, 40, 0, 40);
	const restored = moveShapes([middle], { x: 0, y: 0 }, 0, middle, all);
	assert.equal(restored.length, 3);
	for (const original of all) assert.equal(restored.find(({ id }) => id === original.id), original);
	const collapsed = moveShapes([middle], { x: -40, y: 10 }, 0, middle, all);
	assertSegment(collapsed, 1, 0, 10, 0, 10);
	assertSegment(collapsed, 2, 0, 10, 0, 40);
	assertSegment(collapsed, 3, 0, 40, 0, 40);
	const past = moveShapes([middle], { x: -50, y: 10 }, 0, middle, all);
	assertSegment(past, 1, 0, 10, -10, 10);
	assertSegment(past, 2, -10, 10, -10, 40);
	assertSegment(past, 3, -10, 40, 0, 40);
	const normalized = normalizeLineSegments(collapsed);
	assert.deepEqual(normalized.shapes.map(({ id }) => id), [middle.id]);
	assert.deepEqual([...normalized.idMap], [[middle.id, middle.id]]);
});

test("connections tolerate endpoint rounding and retain tiny existing segment lengths", () => {
	const first = segment(1, 0, 0, 40, 0);
	const middle = segment(2, 40 + 1e-8, 0, 40 + 1e-8, 30);
	const tiny = segment(3, 40 + 1e-8, 30, 40.01 + 1e-8, 30);
	const moved = moveShapes([middle, tiny], { x: 10, y: 10 }, 0, middle, [first, middle, tiny]);
	assertSegment(moved, 1, 0, 10, 50, 10);
	assertSegment(moved, 2, 50 + 1e-8, 10, 50 + 1e-8, 40);
	assertSegment(moved, 3, 50 + 1e-8, 40, 50.01 + 1e-8, 40);
	close(moved.find(({ id }) => id === tiny.id)!.width, 0.01);
});

test("normalization drops zero segments while retaining small segments and nonline shapes", () => {
	const zero = segment(1, 10, 20, 10, 20);
	const tiny = segment(2, 30, 40, 30.001, 40);
	const rectangle = drawShape(3, "rectangle", { x: 100, y: 100 }, { x: 120, y: 120 });
	const result = normalizeLineSegments([zero, tiny, rectangle], new Set([zero.id]));
	assert.deepEqual(result.shapes, [tiny, rectangle]);
	assert.equal(result.shapes[0], tiny);
	assert.equal(result.shapes[1], rectangle);
	assert.deepEqual([...result.idMap], [[2, 2], [3, 3]]);
});

test("normalization merges overlapping ranges and preserves the preferred survivor direction", () => {
	const shapes = [
		segment(1, 0, 0, 20, 0),
		segment(2, 35, 0, 10, 0),
		segment(3, 35, 0, 50, 0),
		segment(4, 80, 0, 80, 20),
		segment(5, 80, 50, 80, 10),
	];
	const result = normalizeLineSegments(shapes, new Set([2, 5]));
	assert.deepEqual(result.shapes.map(({ id }) => id), [2, 5]);
	assertSegment(result.shapes, 2, 50, 0, 0, 0);
	assertSegment(result.shapes, 5, 80, 50, 80, 0);
	assert.deepEqual([...result.idMap], [[1, 2], [2, 2], [3, 2], [4, 5], [5, 5]]);
});

test("normalization merges unordered bridges transitively with containment and reversed duplicates", () => {
	const shapes = [
		segment(1, 0, 0, 10, 0),
		segment(2, 20, 0, 30, 0),
		segment(3, 10, 0, 20, 0),
		segment(4, 5, 0, 8, 0),
		segment(5, 10, 0, 0, 0),
	];
	const original = structuredClone(shapes);
	const result = normalizeLineSegments(shapes);
	assert.equal(result.shapes.length, 1);
	assertSegment(result.shapes, 1, 0, 0, 30, 0);
	assert.deepEqual([...result.idMap], [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
	assert.deepEqual(shapes, original);
	assert.deepEqual(normalizeLineSegments(result.shapes).shapes, result.shapes);
});

test("normalization keeps gaps, offset parallels, crossings and different stroke widths separate", () => {
	const shapes = [
		segment(1, 0, 0, 10, 0),
		segment(2, 10.001, 0, 20, 0),
		segment(3, 0, 0.001, 10, 0.001),
		segment(4, 5, -10, 5, 10),
		{ ...segment(5, 0, 0, 10, 0), lineWidth: 2 },
	];
	const result = normalizeLineSegments(shapes);
	assert.deepEqual(result.shapes, shapes);
	for (const [index, shape] of shapes.entries()) {
		assert.equal(result.shapes[index], shape);
		assert.equal(result.idMap.get(shape.id), shape.id);
	}
});

test("collapsing a loop commits as one preferred line and maps only surviving source IDs", () => {
	const bottom = segment(1, 0, 0, 40, 0);
	const right = segment(2, 40, 0, 40, 30);
	const top = segment(3, 40, 30, 0, 30);
	const left = segment(4, 0, 30, 0, 0);
	const all = [bottom, right, top, left];
	const original = structuredClone(all);
	const moved = moveShapes([right], { x: -40, y: 10 }, 0, right, all);
	const replacements = new Map(moved.map((shape) => [shape.id, shape]));
	const result = normalizeLineSegments(all.map((shape) => replacements.get(shape.id) ?? shape), new Set([right.id]));
	assert.equal(result.shapes.length, 1);
	assertSegment(result.shapes, 2, 0, 10, 0, 40);
	assert.deepEqual([...result.idMap], [[2, 2], [4, 2]]);
	assert.deepEqual(all, original);
	const restored = moveShapes([right], { x: 0, y: 0 }, 0, right, all);
	for (const shape of all) assert.equal(restored.find(({ id }) => id === shape.id), shape);
});

test("normalization chooses the first preferred source and preserves intervening nonline order", () => {
	const first = segment(1, 0, 0, 10, 0);
	const circle = drawShape(2, "circle", { x: 40, y: 40 }, { x: 50, y: 40 });
	const second = segment(3, 20, 0, 5, 0);
	const third = segment(4, 20, 0, 30, 0);
	const result = normalizeLineSegments([first, circle, second, third], new Set([3, 4]));
	assert.deepEqual(result.shapes.map(({ id }) => id), [3, 2]);
	assertSegment(result.shapes, 3, 30, 0, 0, 0);
	assert.equal(result.shapes[1], circle);
	assert.deepEqual(new Set(result.idMap.values()), new Set([2, 3]));
});

test("normalization cleans pointer precision remnants and preserves attached branches", () => {
	const collapsed = segment(1, 160, 160, 160.000012636, 160);
	const first = segment(2, 100, 100, 100, 160);
	const nearDuplicate = segment(3, 100.000012636, 160.000004768, 100.000012636, 100.000004768);
	const nearTouching = segment(4, 200, 100, 220, 100);
	const continuation = segment(5, 220.000012636, 100.000004768, 240, 100.000004768);
	const branch = segment(6, 100, 130, 80, 130);
	const result = normalizeLineSegments([collapsed, first, nearDuplicate, nearTouching, continuation, branch], new Set([nearDuplicate.id]));
	assert.deepEqual(result.shapes.map(({ id }) => id), [3, 4, 6]);
	assertSegment(result.shapes, 3, 100.000012636, 160.000004768, 100.000012636, 100);
	assertSegment(result.shapes, 4, 200, 100, 240, 100);
	assert.equal(result.idMap.has(collapsed.id), false);
	assert.equal(result.idMap.get(first.id), nearDuplicate.id);
	const host = result.shapes.find(({ id }) => id === nearDuplicate.id)!;
	const moved = moveShapes([host], { x: 20, y: 10 }, 0, host, result.shapes);
	assert.deepEqual(moved.map(({ id }) => id), [3, 6]);
	assertSegment(moved, 6, 120, 140, 80, 140);
	const distant = segment(7, 220.001, 100, 240, 100);
	const independent = moveShapes([nearTouching], { x: 0, y: 10 }, 0, nearTouching, [nearTouching, distant]);
	assert.deepEqual(independent.map(({ id }) => id), [nearTouching.id]);
});

test("attribute edits retain centers and strokes and keep circle dimensions linked", () => {
	const circle = { ...drawShape(1, "circle", { x: 10, y: 20 }, { x: 30, y: 20 }), lineWidth: 2.5 };
	for (const attribute of ["width", "height", "radius"] as const) {
		const edited = editShapeAttribute(circle, attribute, 12);
		assert.equal(edited.width, attribute === "radius" ? 24 : 12);
		assert.equal(edited.height, edited.width);
		assert.equal(edited.x, circle.x);
		assert.equal(edited.y, circle.y);
		assert.equal(edited.lineWidth, 2.5);
	}
	const rectangle = drawShape(2, "rectangle", { x: 0, y: 0 }, { x: 30, y: 20 });
	assert.deepEqual(editShapeAttribute(rectangle, "width", 45), { ...rectangle, width: 45 });
	assert.equal(editShapeAttribute(rectangle, "x", -5).x, -5);
	assert.equal(editShapeAttribute(rectangle, "y", 0).y, 0);
	for (const value of [0, -1, Number.NaN, Infinity]) {
		assert.equal(editShapeAttribute(rectangle, "width", value), rectangle);
	}
});

test("angle attributes preserve the orthogonal line constraint", () => {
	const line = segment(1, 0, 0, 20, 0);
	assert.equal(editShapeAttribute(line, "angle", 90).rotation, Math.PI / 2);
	assert.equal(editShapeAttribute(line, "angle", -90).rotation, -Math.PI / 2);
	assert.equal(editShapeAttribute(line, "angle", 45), line);
});
