import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvasView } from "#/components/editor/canvasView.ts";
import { createTextAnchorReader } from "#/components/editor/textAnchors.ts";
import { createPlacementShape } from "#/drawing/placement.ts";
import { drawShape, moveShapes } from "#/drawing/shapes.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";

const snapshot = (scale = 3): Viewer2DSnapshot => ({
	backend: "test",
	message: "",
	camera: { x: 0, y: 0, scale },
	zoom: 1,
	viewport: { width: 1440, height: 900 },
	highlighted: 0,
	diagnostics: {
		width: 1440,
		height: 900,
		drawCalls: 0,
		triangles: 0,
		geometries: 0,
		textures: 0,
	},
});

test("camera subscribers see updated views while panning keeps the grid subscription stable", () => {
	const view = createCanvasView();
	assert.equal(view.getSnapshot(), null);
	assert.equal(view.getGridStep(), 0);
	const received: (Viewer2DSnapshot | null)[] = [];
	const unsubscribe = view.subscribe(() => received.push(view.getSnapshot()));
	const initial = snapshot();
	view.update(initial);
	const grid = view.getGridStep();
	const panned = { ...initial, camera: { ...initial.camera, x: 40, y: 20 } };
	view.update(panned);
	assert.deepEqual(received, [initial, panned]);
	assert.equal(view.getGridStep(), grid);
	view.update({ ...panned, message: "diagnostics only" });
	assert.equal(received.length, 2);
	assert.equal(view.getSnapshot(), panned);
	view.update(snapshot(100));
	assert.notEqual(view.getGridStep(), grid);
	unsubscribe();
	view.update(snapshot(200));
	assert.equal(received.length, 3);
});

test("viewport dimensions notify overlay subscribers without changing the grid", () => {
	const view = createCanvasView();
	const initial = snapshot();
	view.update(initial);
	const grid = view.getGridStep();
	let calls = 0;
	view.subscribe(() => calls++);
	view.update({ ...initial, viewport: { width: 1000, height: 700 } });
	assert.equal(calls, 1);
	assert.equal(view.getGridStep(), grid);
});

const measureText = (value: string) => value.length * 48;

test("unselected labels keep their anchors while unrelated selected geometry moves", () => {
	const read = createTextAnchorReader();
	const label = createPlacementShape("net", 1, { x: 10, y: 20 }, measureText);
	const rectangle = drawShape(2, "rectangle", { x: 0, y: 0 }, { x: 10, y: 10 });
	const original = read([label, rectangle], [rectangle]);
	assert.deepEqual(original, [{ key: "1", x: 10, y: 20 }]);
	const moved = moveShapes([rectangle], { x: 10, y: 10 }, 0)[0];
	assert.equal(read([label, moved], [moved]), original);
});

test("label moves and selection changes invalidate the anchor list without duplicating a selected label", () => {
	const read = createTextAnchorReader();
	const label = createPlacementShape("supply", 1, { x: 0, y: 0 }, measureText);
	const text = createPlacementShape("text", 2, { x: 30, y: 40 }, measureText);
	const original = read([label, text], [label]);
	assert.deepEqual(original, [{ key: "1", x: 0, y: 0 }]);
	assert.equal(read([label, text], []), original);
	const moved = { ...label, x: 12, y: 15 };
	assert.deepEqual(read([moved, text], [moved, text]), [
		{ key: "1", x: 12, y: 15 },
		{ key: "2", x: 30, y: 40 },
	]);
	assert.deepEqual(read([], []), []);
});
