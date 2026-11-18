import assert from "node:assert/strict";
import { test } from "node:test";
import {
	constrainWireEndpoint,
	drawShape,
	type EditorShape,
	editShapeAttribute,
	moveShapes,
	normalizeWireSegments,
	resizeHandles,
	resizeShape,
	snapPoint,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { rulerSpacing, rulerTicks } from "#/engine/ruler.ts";
import { required } from "./helpers/required.ts";

const close = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("rotated corner resizing anchors the opposite corner and clamps dimensions above zero", () => {
	const original = {
		...drawShape(1, "rectangle", { x: 10, y: 20 }, { x: 50, y: 40 }),
		rotation: Math.PI / 3,
	};
	const handle = required(
		resizeHandles(original).find((handle) => handle.id === "1,1"),
	);
	const fixed = required(
		resizeHandles(original).find((handle) => handle.id === "-1,-1"),
	);
	for (const delta of [
		{ x: 15, y: 30 },
		{ x: -1000, y: -1000 },
	]) {
		const resized = resizeShape(original, handle, delta);
		const anchor = required(
			resizeHandles(resized).find((handle) => handle.id === "-1,-1"),
		);
		close(anchor.x, fixed.x);
		close(anchor.y, fixed.y);
		assert.ok(resized.width >= 0.1 && resized.height >= 0.1);
		close(resized.rotation, original.rotation);
	}
});

test("circle resizing keeps its center and diameter consistent", () => {
	const original = drawShape(1, "circle", { x: 10, y: 20 }, { x: 25, y: 20 });
	const handle = required(
		resizeHandles(original).find((handle) => handle.id === "1,0"),
	);
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
		assert.deepEqual(constrainWireEndpoint(start, end), {
			x: expectedX,
			y: expectedY,
		});
		const shape = drawShape(1, "wire", start, end);
		const [first, last] = resizeHandles(shape);
		close(first.x, start.x);
		close(first.y, start.y);
		close(last.x, expectedX);
		close(last.y, expectedY);
		close(
			shape.rotation / (Math.PI / 2),
			Math.round(shape.rotation / (Math.PI / 2)),
		);
		close(shape.height, 1);
	}
});

test("snapping uses the visible grid spacing at different zoom levels and signed coordinates", () => {
	for (const scale of [0.01, 0.8, 8, 80, 800, 8000]) {
		const { minor } = rulerSpacing(scale);
		const ticks = rulerTicks(0, scale, 800);
		close(ticks[1].value - ticks[0].value, minor);
		assert.deepEqual(snapPoint({ x: -3.2 * minor, y: 2.3 * minor }, minor), {
			x: Number((-3 * minor).toPrecision(12)),
			y: Number((2 * minor).toPrecision(12)),
		});
	}
});

test("snapped drawing aligns corners, line endpoints, and circle radii", () => {
	for (const kind of ["rectangle", "triangle", "wire", "circle"] as const) {
		const shape = drawShape(1, kind, { x: -43, y: -37 }, { x: 23, y: 32 }, 10);
		if (kind === "circle") {
			close(shape.x, -40);
			close(shape.y, -40);
			close(shape.width, 200);
		} else if (kind === "wire") {
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

const segment = (id: number, x1: number, y1: number, x2: number, y2: number) =>
	drawShape(id, "wire", { x: x1, y: y1 }, { x: x2, y: y2 });
const endpoints = (shape: EditorShape) =>
	resizeHandles(shape).map(({ x, y }) => ({ x, y }));
function assertSegment(
	shapes: EditorShape[],
	id: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
) {
	const shape = required(shapes.find((shape) => shape.id === id));
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
	const rectangle = drawShape(
		5,
		"rectangle",
		{ x: 10, y: 10 },
		{ x: 50, y: 50 },
	);
	const all = [first, middle, last, separate, rectangle];
	const before = structuredClone(all);
	const moved = moveShapes([middle], { x: 30, y: 10 }, 0, middle, all);
	assert.deepEqual(
		moved.map(({ id }) => id),
		[2, 1, 3],
	);
	assertSegment(moved, 1, 100, 110, 190, 110);
	assertSegment(moved, 2, 190, 110, 190, 175);
	assertSegment(moved, 3, 190, 175, 105, 175);
	close(moved[0].width, middle.width);
	assert.deepEqual(all, before);
});

test("T junction ends follow a selected segment, and a dragged branch reconnects to the trunk", () => {
	const trunk = segment(1, 0, 0, 100, 0);
	const branch = segment(2, 50, 0, 50, 40);
	const all = [trunk, branch];
	const movedTrunk = moveShapes([trunk], { x: 20, y: 10 }, 0, trunk, all);
	assertSegment(movedTrunk, 1, 20, 10, 120, 10);
	assertSegment(movedTrunk, 2, 70, 10, 70, 40);
	// The trunk stays where it is; the moved branch gets a new link to it.
	for (const delta of [
		{ x: 20, y: 10 },
		{ x: 60, y: 10 },
	]) {
		const movedBranch = moveShapes([branch], delta, 0, branch, all);
		assertSegment(movedBranch, 2, 50 + delta.x, 10, 50 + delta.x, 50);
		assert.equal(
			movedBranch.some(({ id }) => id === trunk.id),
			false,
		);
		assertSegment(movedBranch, 3, 50, 0, 50, 10);
		assertSegment(movedBranch, 4, 50, 10, 50 + delta.x, 10);
		assert.equal(movedBranch.length, 3);
	}
});

test("normalization merges overlapping ranges and preserves the preferred survivor direction", () => {
	const shapes = [
		segment(1, 0, 0, 20, 0),
		segment(2, 35, 0, 10, 0),
		segment(3, 35, 0, 50, 0),
		segment(4, 80, 0, 80, 20),
		segment(5, 80, 50, 80, 10),
	];
	const result = normalizeWireSegments(shapes, new Set([2, 5]));
	assert.deepEqual(
		result.shapes.map(({ id }) => id),
		[2, 5],
	);
	assertSegment(result.shapes, 2, 50, 0, 0, 0);
	assertSegment(result.shapes, 5, 80, 50, 80, 0);
	assert.deepEqual(
		[...result.idMap],
		[
			[1, 2],
			[2, 2],
			[3, 2],
			[4, 5],
			[5, 5],
		],
	);
});

test("normalization keeps gaps, offset parallels, crossings and different stroke widths separate", () => {
	const shapes = [
		segment(1, 0, 0, 10, 0),
		segment(2, 10.001, 0, 20, 0),
		segment(3, 0, 0.001, 10, 0.001),
		segment(4, 5, -10, 5, 10),
		{ ...segment(5, 0, 0, 10, 0), lineWidth: 2 },
	];
	const result = normalizeWireSegments(shapes);
	assert.deepEqual(result.shapes, shapes);
	for (const [index, shape] of shapes.entries()) {
		assert.equal(result.shapes[index], shape);
		assert.equal(result.idMap.get(shape.id), shape.id);
	}
});

test("attribute edits retain centers and strokes and keep circle dimensions linked", () => {
	const circle = {
		...drawShape(1, "circle", { x: 10, y: 20 }, { x: 30, y: 20 }),
		lineWidth: 2.5,
	};
	for (const attribute of ["width", "height", "radius"] as const) {
		const edited = editShapeAttribute(circle, attribute, 12);
		assert.equal(edited.width, attribute === "radius" ? 24 : 12);
		assert.equal(edited.height, edited.width);
		assert.equal(edited.x, circle.x);
		assert.equal(edited.y, circle.y);
		assert.equal(edited.lineWidth, 2.5);
	}
	const rectangle = drawShape(2, "rectangle", { x: 0, y: 0 }, { x: 30, y: 20 });
	assert.deepEqual(editShapeAttribute(rectangle, "width", 45), {
		...rectangle,
		width: 45,
	});
	assert.equal(editShapeAttribute(rectangle, "x", -5).x, -5);
	assert.equal(editShapeAttribute(rectangle, "y", 0).y, 0);
	for (const value of [0, -1, Number.NaN, Infinity]) {
		assert.equal(editShapeAttribute(rectangle, "width", value), rectangle);
	}
});

test("text resizing preserves aspect ratio, font size and the opposite corner", () => {
	const text: EditorShape = {
		id: 1,
		kind: "text",
		text: "Label",
		fontSize: 5,
		x: 10,
		y: 20,
		width: 30,
		height: 10,
		rotation: Math.PI / 4,
		lineWidth: 0.2,
	};
	const handle = required(
		resizeHandles(text).find((handle) => handle.id === "1,1"),
	);
	const fixed = required(
		resizeHandles(text).find((handle) => handle.id === "-1,-1"),
	);
	const resized = resizeShape(text, handle, {
		x: handle.x - fixed.x,
		y: handle.y - fixed.y,
	});
	assert.equal(resized.kind, "text");
	if (resized.kind !== "text") return;
	close(resized.fontSize, 10);
	close(resized.width / resized.height, 3);
	const anchor = required(
		resizeHandles(resized).find((handle) => handle.id === "-1,-1"),
	);
	close(anchor.x, fixed.x);
	close(anchor.y, fixed.y);
	assert.equal(resized.text, "Label");
	const edited = editShapeAttribute(text, "fontSize", 12);
	close(edited.width, 72);
	close(edited.height, 24);
	assert.equal(editShapeAttribute(text, "fontSize", 0), text);
	close(editShapeAttribute(text, "angle", 30).rotation, Math.PI / 6);
	const moved = moveShapes([text], { x: 3, y: 7 }, 10)[0];
	close(moved.x, 10);
	close(moved.y, 30);
	assert.equal(moved.kind === "text" && moved.text, "Label");
});

for (const vertical of [false, true])
	test(`normalization splits ${vertical ? "vertical" : "horizontal"} trunks at each branch and retains IDs on repeat`, () => {
		const point = (along: number, across: number) =>
			vertical ? { x: across, y: along } : { x: along, y: across };
		const trunk = {
			...drawShape(1, "wire", point(100, 0), point(0, 0)),
			lineWidth: 0.8,
		};
		const branches = [25, 75].map((along, index) =>
			drawShape(index + 2, "wire", point(along, -20), point(along, 0)),
		);
		const original = [trunk, ...branches];
		const copy = structuredClone(original);
		const result = normalizeWireSegments(original);
		assert.equal(result.shapes.length, 5);
		assert.equal(result.nextShapeId, 6);
		assert.equal(new Set(result.shapes.map(({ id }) => id)).size, 5);
		const pieces = result.shapes.filter(({ lineWidth }) => lineWidth === 0.8);
		assert.deepEqual(
			pieces.map(({ width }) => width),
			[25, 50, 25],
		);
		assert.equal(pieces[0].id, 1);
		for (const along of [25, 75]) {
			const at = point(along, 0);
			assert.equal(
				result.shapes
					.flatMap(resizeHandles)
					.filter((end) => Math.hypot(end.x - at.x, end.y - at.y) < 1e-6)
					.length,
				3,
			);
		}
		const again = normalizeWireSegments(
			result.shapes,
			new Set(),
			result.nextShapeId,
		);
		assert.deepEqual(again.shapes, result.shapes);
		assert.equal(again.nextShapeId, result.nextShapeId);
		assert.deepEqual(original, copy);
	});

test("opposite branches form four segments and removing them rejoins the trunk", () => {
	const trunk = segment(1, 0, 0, 100, 0);
	const up = segment(2, 50, 0, 50, 20);
	const down = segment(3, 50, -20, 50, 0);
	const result = normalizeWireSegments([trunk, up, down]);
	assert.equal(result.shapes.length, 4);
	assert.equal(
		result.shapes
			.flatMap(resizeHandles)
			.filter(({ x, y }) => Math.abs(x - 50) < 1e-6 && Math.abs(y) < 1e-6)
			.length,
		4,
	);
	assert.deepEqual(normalizeWireSegments(result.shapes).shapes, result.shapes);
	const rejoined = normalizeWireSegments(
		result.shapes.filter(({ rotation }) => rotation === 0),
	);
	assert.equal(rejoined.shapes.length, 1);
	assert.equal(rejoined.shapes[0].width, 100);
});

test("a pin at a crossing splits both wires into four ends", () => {
	const at = { x: 50, y: 0 };
	const result = normalizeWireSegments([
		segment(1, 0, 0, 100, 0),
		segment(2, 50, -20, 50, 20),
		drawShape(3, "pin", at, at),
	]);
	const wires = result.shapes.filter((shape) => shape.kind === "wire");
	assert.equal(wires.length, 4);
	assert.equal(
		wires
			.flatMap(resizeHandles)
			.filter(({ x, y }) => Math.hypot(x - at.x, y - at.y) < 1e-6).length,
		4,
	);
});
