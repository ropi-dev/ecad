import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type EditorShape,
	shapeAt,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import { createPad } from "@ecad/drawing-core/footprint/shapes.ts";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { canvasDragStep } from "#/components/editor/canvasDrag.ts";
import { createCanvasView } from "#/components/editor/canvasView.ts";
import { viewMapping } from "#/engine/view-projection.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";
import { BOARD_SURFACE_Z, layerSurfaceZ } from "#/footprint/board.ts";
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

const screenAt = (
	view: Parameters<typeof viewMapping>[0],
	point: { x: number; y: number },
	z?: number,
) => viewMapping(view).toScreen(point, z);
const worldAt = (
	view: Parameters<typeof viewMapping>[0],
	screen: { x: number; y: number },
	z?: number,
) => viewMapping(view).toWorld(screen, z);

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

test("a turned view has no point where it sees the plane at a grazing angle", () => {
	const low = new PerspectiveCamera(25, 1.5, 0.1, 1000);
	low.position.set(0, -20, 2);
	const view = turnedView(low);
	const centre = required(worldAt(view, { x: 600, y: 400 }, 0));
	near(centre.x, 0);
	near(centre.y, 0);
	const far = required(worldAt(view, { x: 600, y: 300 }, 0));
	assert.ok(far.y > 10 && far.y < 100);
	assert.equal(worldAt(view, { x: 600, y: 240 }, 0), null);
	assert.equal(worldAt(view, { x: 600, y: 100 }, 0), null);
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

const copperSurfaces = (layers: readonly FootprintLayer[], eyeZ: number) => {
	const heights = layers.map((layer) => (layer.startsWith("B.") ? -1.8 : -0.1));
	return eyeZ >= 0 ? Math.max(...heights) : Math.min(...heights);
};

test("the flat view and a turned view answer the same questions, and only the turned one has heights", () => {
	const front = pad(1, 0, "F.Cu");
	const back = pad(2, 0, "B.Cu");
	const through = createPad(3, { x: 3, y: 0 }, "through-hole", "3", "F.Cu");
	const shapes = [front, back, through];
	const view = createCanvasView("mm");
	assert.equal(view.getProjection(), null);
	const { projection: _projection, ...flatView } = perspective();
	view.update(flatView);
	view.setSurfaces(copperSurfaces);
	const flat = required(view.getProjection());
	assert.equal(flat.turned, false);
	assert.equal(flat.scale, 40);
	assert.equal(flat.heightOf(back), 0);
	assert.equal(flat.nearestLast(shapes), shapes);
	const around = { minX: 570, minY: 360, maxX: 630, maxY: 440 };
	const within = { minX: 590, minY: 390, maxX: 610, maxY: 410 };
	assert.equal(flat.inScreenBox(back, around, "window"), true);
	assert.equal(flat.inScreenBox(through, around, "crossing"), false);
	assert.equal(flat.inScreenBox(back, within, "window"), false);
	assert.equal(flat.inScreenBox(back, within, "crossing"), true);
	assert.deepEqual(flat.toWorld({ x: 640, y: 360 }, 5), { x: 1, y: 1 });
	assert.equal(view.getProjection(), flat);

	let changes = 0;
	view.subscribe(() => changes++);
	view.update(perspective());
	const above = required(view.getProjection());
	assert.equal(changes, 1);
	assert.equal(above.turned, true);
	assert.equal(above.heightOf(front), -0.1);
	assert.equal(above.heightOf(back), -1.8);
	assert.equal(above.heightOf(through), -0.1);
	assert.deepEqual(
		above.nearestLast([front, back, through]).map((shape) => shape.id),
		[2, 1, 3],
	);
	const onBack = required(above.toScreen(back, above.heightOf(back)));
	const onFront = required(above.toScreen(front, above.heightOf(front)));
	assert.ok(onBack.y > onFront.y + 10);

	const below = new PerspectiveCamera(25, 1.5, 0.1, 1000);
	below.position.set(10, -15, -18);
	view.update(turnedView(below));
	const under = required(view.getProjection());
	assert.equal(under.heightOf(through), -1.8);
	assert.deepEqual(
		under.nearestLast([front, back, through]).map((shape) => shape.id),
		[1, 2, 3],
	);

	view.setSurfaces(null);
	assert.equal(changes, 3);
	assert.equal(required(view.getProjection()).heightOf(back), 0);

	view.clear();
	assert.equal(changes, 4);
	assert.equal(view.getProjection(), null);
	assert.equal(view.getSnapshot(), null);
	view.clear();
	assert.equal(changes, 4);
});

test("a camera between the board's top and its middle still picks the top side first", () => {
	const front = pad(1, 0, "F.Cu");
	const back = pad(2, 0, "B.Cu");
	const through = createPad(3, { x: 3, y: 0 }, "through-hole", "3", "F.Cu");
	const view = createCanvasView("mm");
	view.setSurfaces((layers, eyeZ) => layerSurfaceZ(layers, new Set(), eyeZ));
	const camera = new PerspectiveCamera(25, 1.5, 0.1, 1000);
	camera.position.set(10, -15, -BOARD_SURFACE_Z / 2);
	view.update(turnedView(camera));
	const edgeOn = required(view.getProjection());
	assert.equal(edgeOn.heightOf(through), edgeOn.heightOf(front));
	assert.deepEqual(
		edgeOn.nearestLast([front, through, back]).map((shape) => shape.id),
		[2, 1, 3],
	);
});

test("a selection rectangle leaves out an item that reaches behind the camera", () => {
	const item = createPad(1, { x: 0, y: -1.5 }, "smd", "1", "F.Cu");
	const camera = new PerspectiveCamera(25, 1.5, 0.01, 1000);
	camera.position.set(0, -1, 0.5);
	const canvas = createCanvasView("mm");
	canvas.update(turnedView(camera));
	const projection = required(canvas.getProjection());
	const corners = shapeOutline(item).map((corner) =>
		projection.toScreen(corner),
	);
	assert.ok(corners.some((corner) => corner === null));
	assert.ok(corners.some((corner) => corner !== null));
	const everything = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };
	assert.equal(projection.inScreenBox(item, everything, "window"), false);
	assert.equal(projection.inScreenBox(item, everything, "crossing"), false);
});

test("a marquee in a turned view selects by what its screen rectangle covers", () => {
	const left = pad(1, -2, "F.Cu");
	const right = pad(2, 2, "F.Cu");
	const canvas = createCanvasView("mm");
	canvas.update(perspective());
	const { inScreenBox } = required(canvas.getProjection());
	const boxes: unknown[] = [];
	const step = canvasDragStep(
		{
			pointerId: 1,
			canvas: {} as HTMLCanvasElement,
			start: null,
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
		null,
		{ x: 620, y: 700 },
		{
			shapes: [left, right],
			allowLocked: false,
			cameraScale: () => 40,
			nextId: () => 3,
			inScreenBox: (shape, box, mode) => {
				boxes.push(box);
				return inScreenBox(shape, box, mode);
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
