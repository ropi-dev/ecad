import assert from "node:assert/strict";
import { test } from "node:test";
import {
	drawShape,
	type EditorShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	type CanvasDrag,
	canvasDragStep,
} from "#/components/editor/canvasDrag.ts";
import { createCanvasView } from "#/components/editor/canvasView.ts";
import { required } from "./helpers/required.ts";

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
		selectionMode: "replace",
		...overrides,
	};
}

const flatView = createCanvasView();
flatView.update({
	backend: "test",
	message: "",
	camera: { x: 120, y: -80, scale: 4 },
	zoom: 1,
	viewport: { width: 1200, height: 800 },
	highlighted: 0,
	diagnostics: {
		width: 1200,
		height: 800,
		drawCalls: 0,
		triangles: 0,
		geometries: 0,
		textures: 0,
	},
});
const flat = required(flatView.getProjection());
const onScreen = (x: number, y: number) => required(flat.toScreen({ x, y }));

function context(scale = 1) {
	const calls = { scale: 0, nextId: 0 };
	return {
		calls,
		shapes: [box, far],
		allowLocked: false,
		inScreenBox: flat.inScreenBox,
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

test("dragging right selects enclosed shapes; dragging left selects crossed shapes", () => {
	assert.deepEqual(onScreen(-5, -5), { x: 100, y: 100 });
	const window = canvasDragStep(
		drag({ mode: "marquee", start: null }),
		null,
		onScreen(45, 15),
		context(),
	);
	assert.deepEqual(window.effect, {
		kind: "marquee",
		marquee: {
			start: { x: 100, y: 100 },
			end: { x: 300, y: 20 },
			mode: "window",
			selection: "replace",
		},
		selection: new Set([box.id]),
	});

	const crossing = canvasDragStep(
		drag({ mode: "marquee", startScreen: onScreen(45, 15) }),
		{ x: 5, y: 5 },
		onScreen(5, 5),
		context(),
	);
	assert.equal(crossing.effect.kind, "marquee");
	if (crossing.effect.kind !== "marquee") return;
	assert.equal(crossing.effect.marquee.mode, "crossing");
	assert.deepEqual(crossing.effect.selection, new Set([box.id, far.id]));
});

test("marquee modes add to, subtract from or toggle the selection", () => {
	const selection = (selectionMode: CanvasDrag["selectionMode"]) => {
		const step = canvasDragStep(
			drag({
				mode: "marquee",
				previousSelection: new Set([box.id, far.id]),
				selectionMode,
			}),
			{ x: 15, y: 15 },
			onScreen(15, 15),
			context(),
		);
		return step.effect.kind === "marquee" ? step.effect.selection : undefined;
	};
	assert.deepEqual(selection("add"), new Set([box.id, far.id]));
	assert.deepEqual(selection("remove"), new Set([far.id]));
	assert.deepEqual(selection("replace"), new Set([box.id]));
	assert.deepEqual(selection("toggle"), new Set([far.id]));
});

test("a duplicate moves every copy by one snapped step without adding wires", () => {
	const label: EditorShape = {
		id: 1,
		kind: "text",
		x: 10,
		y: 0,
		width: 8,
		height: 2,
		lineWidth: 0.2,
		rotation: 0,
		fontSize: 1.5,
		horizontalAlign: "left",
		verticalAlign: "bottom",
		electrical: "net",
		text: "SIGNAL",
	};
	const wire = drawShape(2, "wire", { x: 0, y: 0 }, { x: 20, y: 0 });
	const active = drag({
		mode: "duplicate",
		created: true,
		valid: false,
		gridStep: 5,
		originals: [label, wire],
		anchorShape: label,
		initialShapes: [label, wire],
	});
	const step = canvasDragStep(
		active,
		{ x: 6, y: -9 },
		{ x: 120, y: 100 },
		context(),
	);
	assert.deepEqual(step.effect, {
		kind: "preview",
		movingShapeId: 1,
		replacements: [
			{ ...label, x: 15, y: -10 },
			{ ...wire, x: wire.x + 5, y: wire.y - 10 },
		],
		base: [label, wire],
	});
});
