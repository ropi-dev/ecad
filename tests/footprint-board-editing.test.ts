import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type EditorShape,
	shapeAt,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { createPad } from "@ecad/drawing-core/footprint/shapes.ts";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { canvasDragStep } from "#/components/editor/canvasDrag.ts";
import { createCanvasView } from "#/components/editor/canvasView.ts";
import { screenAt, worldAt } from "#/engine/view-projection.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";
import { outlineInBox, shapeOutline } from "#/footprint/outline.ts";
import { required } from "./helpers/required.ts";

const viewport = { width: 1200, height: 800 };

function turnedView(
	camera: PerspectiveCamera | OrthographicCamera,
): Viewer2DSnapshot {
	camera.up.set(0, 0, 1);
	camera.lookAt(new Vector3(0, 0, 0));
	camera.updateMatrixWorld();
	camera.updateProjectionMatrix();
	return {
		backend: "test",
		message: "",
		camera: { x: 0, y: 0, scale: 40 },
		projection: {
			matrix: camera.projectionMatrix
				.clone()
				.multiply(camera.matrixWorldInverse)
				.toArray(),
			eyeZ: camera.position.z,
		},
		zoom: 1,
		viewport,
		highlighted: 0,
		diagnostics: {
			width: 1200,
			height: 800,
			drawCalls: 0,
			triangles: 0,
			geometries: 0,
			textures: 0,
		},
	};
}

const perspective = () => {
	const camera = new PerspectiveCamera(25, 1.5, 0.1, 1000);
	camera.position.set(10, -15, 18);
	return turnedView(camera);
};

const near = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);

test("a flat view maps points as its camera does, whatever the height", () => {
	const flat = { camera: { x: 2, y: -1, scale: 50 }, viewport };
	assert.deepEqual(screenAt(flat, { x: 2, y: -1 }, 5), { x: 600, y: 400 });
	assert.deepEqual(worldAt(flat, { x: 650, y: 350 }, -3), { x: 3, y: 0 });
});

test("a turned view reads the pointer on the plane at an item's height", () => {
	const view = perspective();
	const centre = required(screenAt(view, { x: 0, y: 0 }, 0));
	near(centre.x, 600);
	near(centre.y, 400);
	for (const height of [0, -1.83, 0.04])
		for (const point of [
			{ x: 1.25, y: -0.5 },
			{ x: -3, y: 2 },
		]) {
			const back = required(
				worldAt(view, required(screenAt(view, point, height)), height),
			);
			near(back.x, point.x);
			near(back.y, point.y);
		}
	const onTop = required(worldAt(view, centre, 0));
	const onBack = required(worldAt(view, centre, -1.83));
	assert.ok(Math.hypot(onTop.x - onBack.x, onTop.y - onBack.y) > 0.5);

	const orthographic = new OrthographicCamera(-15, 15, 10, -10, 0.1, 1000);
	orthographic.position.set(10, -15, 18);
	const parallel = turnedView(orthographic);
	const there = required(
		worldAt(parallel, required(screenAt(parallel, { x: 4, y: 3 }, 0.5)), 0.5),
	);
	near(there.x, 4);
	near(there.y, 3);
});

test("a turned view has no point for a plane seen edge-on or for one behind the camera", () => {
	const edgeOn = new PerspectiveCamera(25, 1.5, 0.1, 1000);
	edgeOn.position.set(0, -20, 0);
	assert.equal(worldAt(turnedView(edgeOn), { x: 600, y: 300 }, 0), null);
	const view = perspective();
	assert.equal(screenAt(view, { x: 20, y: -30 }, 36), null);
	assert.equal(worldAt(view, { x: 600, y: -4000 }, 0), null);
});

test("the canvas view reports a turn of the camera that keeps the top view it returns to", () => {
	const view = createCanvasView("mm");
	let changes = 0;
	view.subscribe(() => changes++);
	const first = perspective();
	view.update(first);
	view.update({ ...first, message: "same view" });
	assert.equal(changes, 1);
	const turned = new PerspectiveCamera(25, 1.5, 0.1, 1000);
	turned.position.set(-12, -15, 18);
	view.update(turnedView(turned));
	assert.equal(changes, 2);
	const { projection: _projection, ...flat } = first;
	view.update(flat);
	assert.equal(changes, 3);
	assert.equal(view.getSnapshot()?.projection, undefined);
});

const pad = (id: number, x: number, layer: "F.Cu" | "B.Cu") =>
	createPad(id, { x, y: 0 }, "smd", String(id), layer);

test("a hit test takes each shape's own point, and skips a shape that has none", () => {
	const front = pad(1, 0, "F.Cu");
	const back = pad(2, 5, "B.Cu");
	const shapes: EditorShape[] = [back, front];
	const pointer = { x: 0, y: 0 };
	assert.equal(shapeAt(shapes, pointer, 0.05), front);
	const backUnderPointer = (shape: EditorShape) =>
		shape === back ? { x: 5, y: 0 } : { x: 9, y: 9 };
	assert.equal(shapeAt(shapes, backUnderPointer, 0.05), back);
	assert.equal(
		shapeAt(shapes, (shape) => (shape === front ? null : { x: 9, y: 9 }), 0.05),
		undefined,
	);
});

test("an outline follows its item's kind, size and rotation", () => {
	const turnedPad = { ...pad(1, 2, "F.Cu"), rotation: Math.PI / 2 };
	const corners = shapeOutline(turnedPad);
	assert.equal(corners.length, 4);
	near(Math.max(...corners.map((corner) => corner.x)), 2.75);
	near(Math.max(...corners.map((corner) => corner.y)), 0.5);
	const wire: EditorShape = {
		id: 2,
		kind: "line",
		layer: "F.SilkS",
		x: 0,
		y: 1,
		width: 2,
		height: 1,
		rotation: 0,
		lineWidth: 0.2,
	};
	assert.deepEqual(
		shapeOutline(wire).map((corner) => [corner.x, corner.y]),
		[
			[-1, 0.9],
			[1, 0.9],
			[1, 1.1],
			[-1, 1.1],
		],
	);
	const circle = shapeOutline({ ...turnedPad, kind: "circle", width: 2 });
	for (const point of circle) near(Math.hypot(point.x - 2, point.y), 1);
});

test("a window rectangle needs a whole outline and a crossing one any part of it", () => {
	const square = [
		{ x: 10, y: 10 },
		{ x: 30, y: 10 },
		{ x: 30, y: 30 },
		{ x: 10, y: 30 },
	];
	const box = (minX: number, minY: number, maxX: number, maxY: number) => ({
		minX,
		minY,
		maxX,
		maxY,
	});
	assert.equal(outlineInBox(square, box(0, 0, 40, 40), "window"), true);
	assert.equal(outlineInBox(square, box(0, 0, 20, 40), "window"), false);
	assert.equal(outlineInBox(square, box(0, 0, 20, 40), "crossing"), true);
	assert.equal(outlineInBox(square, box(15, 15, 25, 25), "crossing"), true);
	assert.equal(outlineInBox(square, box(15, 0, 25, 40), "crossing"), true);
	assert.equal(outlineInBox(square, box(40, 40, 50, 50), "crossing"), false);
	assert.equal(outlineInBox([], box(0, 0, 40, 40), "window"), false);
});

test("a marquee in a turned view selects by what its screen rectangle covers", () => {
	const left = pad(1, -2, "F.Cu");
	const right = pad(2, 2, "F.Cu");
	const view = perspective();
	const boxes: unknown[] = [];
	const step = canvasDragStep(
		{
			pointerId: 1,
			canvas: {} as HTMLCanvasElement,
			start: { x: 0, y: 0 },
			startScreen: { x: 100, y: 100 },
			previousSelection: new Set(),
			mode: "marquee",
			previousChild: null,
			gridStep: 0.1,
			moved: false,
			originals: [],
			initialShapes: [left, right],
			created: false,
			valid: false,
			selectionMode: "replace",
		},
		{ x: 50, y: 50 },
		{ x: 620, y: 700 },
		{
			shapes: [left, right],
			allowLocked: false,
			cameraScale: () => 40,
			nextId: () => 3,
			inMarquee: (shape, box, mode) => {
				boxes.push(box);
				return outlineInBox(
					shapeOutline(shape).flatMap(
						(corner) => screenAt(view, corner, 0) ?? [],
					),
					box,
					mode,
				);
			},
		},
	);
	assert.deepEqual(boxes[0], { minX: 100, minY: 100, maxX: 620, maxY: 700 });
	assert.equal(step.effect.kind, "marquee");
	assert.deepEqual(
		step.effect.kind === "marquee" ? [...step.effect.selection] : [],
		[1],
	);
});
