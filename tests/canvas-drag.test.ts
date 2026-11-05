import assert from "node:assert/strict";
import { test } from "node:test";
import { drawShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	type CanvasDrag,
	canvasDragStep,
} from "#/components/editor/canvasDrag.ts";

const box = drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 10, y: 10 });
const far = drawShape(2, "rectangle", { x: 40, y: 0 }, { x: 50, y: 10 });

function drag(overrides: Partial<CanvasDrag>): CanvasDrag {
	return {
		pointerId: 1,
		canvas: {} as HTMLCanvasElement,
		start: { x: 0, y: 0 },
		startScreen: { x: 100, y: 100 },
		previousSelection: new Set(),
		mode: "move",
		previousChild: null,
		gridStep: 0,
		moved: false,
		originals: [box],
		initialShapes: [box, far],
		created: false,
		valid: true,
		additive: false,
		...overrides,
	};
}

function context(scale = 1) {
	const calls = { scale: 0, nextId: 0 };
	return {
		calls,
		shapes: [box, far],
		allowLocked: false,
		cameraScale() {
			calls.scale++;
			return scale;
		},
		nextId() {
			calls.nextId++;
			return 3;
		},
	};
}

test("a snapped move waits for the 3 px threshold, then previews against the initial shapes", () => {
	const active = drag({ gridStep: 2.54 });
	const still = canvasDragStep(
		active,
		{ x: 1, y: 1 },
		{ x: 102, y: 101 },
		context(),
	);
	assert.deepEqual(still, {
		moved: false,
		valid: true,
		effect: { kind: "none" },
	});

	const ctx = context();
	const step = canvasDragStep(
		active,
		{ x: 5.08, y: 0 },
		{ x: 110, y: 100 },
		ctx,
	);
	assert.equal(step.moved, true);
	assert.equal(step.effect.kind, "preview");
	if (step.effect.kind !== "preview") return;
	assert.equal(step.effect.movingShapeId, box.id);
	assert.equal(step.effect.base, active.initialShapes);
	const moved = step.effect.replacements.find((shape) => shape.id === box.id);
	assert.ok(moved);
	assert.ok(Math.abs(moved.x - (box.x + 5.08)) < 1e-9);
	assert.equal(moved.y, box.y);
	assert.equal(ctx.calls.nextId, 1);
	assert.equal(ctx.calls.scale, 0);
});

test("an earlier move stays moved after the pointer returns to its start", () => {
	const step = canvasDragStep(
		drag({ moved: true }),
		{ x: 0, y: 0 },
		{ x: 100, y: 100 },
		context(),
	);
	assert.equal(step.moved, true);
	assert.equal(step.effect.kind, "preview");
});

test("a duplicate becomes valid only once it has moved", () => {
	const active = drag({ mode: "duplicate", valid: false, created: true });
	const still = canvasDragStep(
		active,
		{ x: 0, y: 0 },
		{ x: 101, y: 100 },
		context(),
	);
	assert.equal(still.valid, false);
	assert.equal(still.effect.kind, "none");
	const step = canvasDragStep(
		active,
		{ x: 20, y: 0 },
		{ x: 120, y: 100 },
		context(),
	);
	assert.equal(step.valid, true);
	assert.equal(step.effect.kind, "preview");
});

test("drawing previews the draft and rejects shapes under 3 screen pixels", () => {
	const draft = drawShape(7, "rectangle", { x: 0, y: 0 }, { x: 0, y: 0 });
	const active = drag({
		mode: "draw",
		originals: [draft],
		created: true,
		valid: false,
	});
	const ctx = context(1);
	const large = canvasDragStep(
		active,
		{ x: 20, y: 10 },
		{ x: 120, y: 110 },
		ctx,
	);
	assert.equal(large.valid, true);
	assert.equal(ctx.calls.scale, 1);
	assert.equal(large.effect.kind, "preview");
	if (large.effect.kind !== "preview") return;
	assert.equal(large.effect.movingShapeId, 7);
	assert.equal(large.effect.base, undefined);
	assert.equal(large.effect.replacements[0].width, 20);
	assert.equal(large.effect.replacements[0].height, 10);

	const small = canvasDragStep(
		active,
		{ x: 20, y: 10 },
		{ x: 120, y: 110 },
		context(0.1),
	);
	assert.equal(small.valid, false);
});

test("text and symbols are not drawn by dragging", () => {
	const text = {
		...box,
		kind: "text",
	} as unknown as CanvasDrag["originals"][0];
	const step = canvasDragStep(
		drag({ mode: "draw", originals: [text] }),
		{ x: 20, y: 20 },
		{ x: 140, y: 140 },
		context(),
	);
	assert.equal(step.effect.kind, "none");
});

test("dragging right selects enclosed shapes; dragging left selects crossed shapes", () => {
	const window = canvasDragStep(
		drag({ mode: "marquee", start: { x: -5, y: -5 } }),
		{ x: 45, y: 15 },
		{ x: 300, y: 50 },
		context(),
	);
	assert.deepEqual(window.effect, {
		kind: "marquee",
		marquee: {
			start: { x: 100, y: 100 },
			end: { x: 300, y: 50 },
			mode: "window",
		},
		selection: new Set([box.id]),
	});

	const crossing = canvasDragStep(
		drag({ mode: "marquee", start: { x: 45, y: 15 } }),
		{ x: 5, y: 5 },
		{ x: 20, y: 120 },
		context(),
	);
	assert.equal(crossing.effect.kind, "marquee");
	if (crossing.effect.kind !== "marquee") return;
	assert.equal(crossing.effect.marquee.mode, "crossing");
	assert.deepEqual(crossing.effect.selection, new Set([box.id, far.id]));
});

test("a marquee back under the threshold restores the selection it started with", () => {
	const previousSelection = new Set([far.id]);
	assert.deepEqual(
		canvasDragStep(
			drag({ mode: "marquee", additive: true, previousSelection }),
			{ x: 0, y: 0 },
			{ x: 101, y: 101 },
			context(),
		).effect,
		{ kind: "marquee-cancel", selection: previousSelection },
	);
	assert.deepEqual(
		canvasDragStep(
			drag({ mode: "marquee", previousSelection }),
			{ x: 0, y: 0 },
			{ x: 101, y: 101 },
			context(),
		).effect,
		{ kind: "marquee-cancel", selection: new Set() },
	);
});

test("a press on a pin waits for movement before it drags", () => {
	const step = canvasDragStep(
		drag({ wireStart: { x: 0, y: 0 } }),
		{ x: 0, y: 0 },
		{ x: 101, y: 100 },
		context(),
	);
	assert.deepEqual(step.effect, { kind: "none" });
});
