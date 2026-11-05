import assert from "node:assert/strict";
import { test } from "node:test";
import {
	drawShape,
	type EditorShape,
	moveShapes,
	pinTerminals,
	resizeHandles,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	createWireRoutingContext,
	pinEnds,
	routeWireConnection,
} from "@ecad/drawing-core/drawing/wire-routing.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "./helpers/required.ts";

const resistor = (id: number, x: number, y: number) =>
	createSymbol(
		id,
		required(symbolDefinitions.find(({ id }) => id === "resistor")),
		{ x, y },
	);
const wire = (id: number, x: number, y: number, endX: number, endY: number) =>
	drawShape(id, "wire", { x, y }, { x: endX, y: endY });

function segmentsOf(points: readonly Point[]) {
	return points.slice(1).map((end, index) => [points[index], end] as const);
}

const onSegment = (point: Point, [a, b]: readonly [Point, Point]) =>
	Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) <
		1e-6 &&
	point.x >= Math.min(a.x, b.x) - 1e-6 &&
	point.x <= Math.max(a.x, b.x) + 1e-6 &&
	point.y >= Math.min(a.y, b.y) - 1e-6 &&
	point.y <= Math.max(a.y, b.y) + 1e-6;

function assertOrthogonal(points: readonly Point[]) {
	for (const [a, b] of segmentsOf(points))
		assert.ok(
			Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9,
			"segments stay orthogonal",
		);
}

test("a pin-to-pin route leaves and enters along the leads and avoids a part in between", () => {
	const left = resistor(1, 0, 0);
	const right = resistor(2, 25.4, 0);
	const blocker = resistor(3, 12.7, 0);
	const shapes = [left, right, blocker];
	const start = pinTerminals(left)[1];
	const end = pinTerminals(right)[0];
	const points = routeWireConnection(
		createWireRoutingContext(shapes),
		start,
		end,
		{ pitch: 1.27, fromPin: true },
	);
	assertOrthogonal(points);
	assert.deepEqual(points[0], start);
	assert.deepEqual(points.at(-1), end);
	// Out of the start pin to the right, into the end pin from the left.
	assert.ok(points[1].x > start.x && points[1].y === start.y);
	const before = required(points.at(-2));
	assert.ok(before.x < end.x && before.y === end.y);
	for (const pin of pinTerminals(blocker))
		assert.ok(
			!segmentsOf(points).some((segment) => onSegment(pin, segment)),
			"the route never touches the blocking part's pins",
		);
	assert.ok(points.length > 2, "the route detours");
});

test("routes cross foreign wires at right angles but never run along or end on them", () => {
	const left = resistor(1, 0, 0);
	const right = resistor(2, 25.4, 10.16);
	const foreign = wire(10, 12.7, -20, 12.7, 20);
	const parallel = wire(11, -10, 10.16, 20, 10.16);
	const context = createWireRoutingContext([left, right, foreign, parallel]);
	const start = pinTerminals(left)[1];
	const end = pinTerminals(right)[0];
	const points = routeWireConnection(context, start, end, {
		pitch: 1.27,
		fromPin: true,
	});
	assertOrthogonal(points);
	const [foreignStart, foreignEnd] = resizeHandles(foreign);
	const [parallelStart, parallelEnd] = resizeHandles(parallel);
	for (const corner of points.slice(1, -1)) {
		assert.ok(!onSegment(corner, [foreignStart, foreignEnd]));
		assert.ok(!onSegment(corner, [parallelStart, parallelEnd]));
	}
	for (const [a, b] of segmentsOf(points))
		if (Math.abs(a.y - b.y) < 1e-9)
			assert.ok(
				Math.abs(a.y - 10.16) > 1e-6 ||
					Math.max(a.x, b.x) <= parallelStart.x + 1e-6 ||
					Math.min(a.x, b.x) >= parallelEnd.x - 1e-6,
				"no overlap with the parallel foreign wire",
			);
});

test("routing is deterministic for the same input", () => {
	const shapes = [
		resistor(1, 0, 0),
		resistor(2, 25.4, 12.7),
		resistor(3, 12.7, 6.35),
	];
	const run = () =>
		routeWireConnection(
			createWireRoutingContext(shapes),
			pinTerminals(shapes[0])[1],
			pinTerminals(shapes[1])[0],
			{ pitch: 1.27, fromPin: true },
		);
	assert.deepEqual(run(), run());
});

test("built-in symbol pins face away from the body", () => {
	const symbol = resistor(1, 0, 0);
	assert.deepEqual(
		pinEnds(symbol).map(({ outward }) => outward),
		[2, 0],
	);
	const turned = { ...symbol, rotation: Math.PI / 2 };
	assert.deepEqual(
		pinEnds(turned).map(({ outward }) => outward),
		[3, 1],
	);
});

test("moving a part reroutes its wire around another part instead of through it", () => {
	const fixed = resistor(1, 0, 0);
	const moving = resistor(2, 25.4, 0);
	const blocker = resistor(3, 38.1, 12.7);
	const [, start] = pinTerminals(fixed);
	const [end] = pinTerminals(moving);
	const shapes: EditorShape[] = [
		fixed,
		moving,
		blocker,
		wire(4, start.x, start.y, end.x, end.y),
	];
	const moved = moveShapes(
		[moving],
		{ x: 25.4, y: 12.7 },
		1.27,
		moving,
		shapes,
	);
	const wires = moved.filter(
		(shape) => shape.kind === "wire" && shape.width > 1e-4,
	);
	for (const pin of pinTerminals(blocker))
		for (const shape of wires) {
			const [a, b] = resizeHandles(shape);
			assert.ok(!onSegment(pin, [a, b]), "no wire touches the other part");
		}
	assert.equal(wires[0].id, 4, "the rerouted wire keeps its ID");
});
