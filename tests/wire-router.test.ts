import assert from "node:assert/strict";
import { test } from "node:test";
import { electricalNets } from "@ecad/drawing-core/drawing/named-nets.ts";
import {
	drawShape,
	type EditorShape,
	isUnsafeMove,
	moveShapes,
	pinTerminals,
	resizeHandles,
	withFullRouting,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	createWireRoutingContext,
	fallbackPath,
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
	const { points, clear } = routeWireConnection(
		createWireRoutingContext(shapes),
		start,
		end,
		{ pitch: 1.27, fromPin: true },
	);
	assert.ok(clear);
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
	const { points } = routeWireConnection(context, start, end, {
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

const pin = (id: number, x: number, y: number) =>
	drawShape(id, "pin", { x, y }, { x, y });
const visible = (shapes: EditorShape[]) =>
	shapes.filter((shape) => shape.kind === "wire" && shape.width > 1e-4);
const ends = (shape: EditorShape) =>
	resizeHandles(shape).map(({ x, y }) => [
		Number(x.toFixed(6)) + 0,
		Number(y.toFixed(6)) + 0,
	]);
/** The shapes after a move, as committing would apply them. */
function applyMove(all: EditorShape[], moved: EditorShape[]) {
	const byId = new Map(moved.map((shape) => [shape.id, shape]));
	const ids = new Set(all.map(({ id }) => id));
	return [
		...all.map((shape) => byId.get(shape.id) ?? shape),
		...moved.filter(({ id }) => !ids.has(id)),
	].filter((shape) => shape.kind !== "wire" || shape.width > 1e-4);
}
const pinGroups = (shapes: EditorShape[]) =>
	electricalNets(shapes)
		.map((net) =>
			net.pins
				.map(({ shapeId, pinId }) => `${shapeId}:${pinId}`)
				.sort()
				.join(" "),
		)
		.filter(Boolean)
		.sort();

test("a pin moved off a stationary pin keeps that pin's own wires", () => {
	const moving = pin(1, 0, 0);
	const fixed = pin(2, 0, 0);
	const far = pin(3, 30, 0);
	for (const wireToFar of [true, false]) {
		const shapes: EditorShape[] = [
			moving,
			fixed,
			...(wireToFar ? [far] : []),
			wire(4, 0, 0, 30, 0),
		];
		const moved = moveShapes([moving], { x: 0, y: 10 }, 0, moving, shapes);
		assert.equal(
			moved.some((shape) => shape.id === 4),
			false,
			"the stationary pin's wire is untouched",
		);
		assert.deepEqual(visible(moved).map(ends), [
			[
				[0, 0],
				[0, 10],
			],
		]);
	}
});

test("dragging a segment between two pins stretches its neighbours without a jog", () => {
	const part = resistor(1, 0, 0);
	const [, right] = pinTerminals(part);
	const other = pin(2, 20.32, 0);
	const top = wire(4, right.x, -10.16, 20.32, -10.16);
	const shapes: EditorShape[] = [
		part,
		other,
		wire(3, right.x, right.y, right.x, -10.16),
		top,
		wire(5, 20.32, -10.16, 20.32, 0),
	];
	const moved = moveShapes([top], { x: 0, y: -2.54 }, 1.27, top, shapes);
	assert.deepEqual(moved.map(({ id }) => id).sort(), [3, 4, 5]);
	assert.deepEqual(ends(required(moved.find(({ id }) => id === 3))), [
		[right.x, 0],
		[right.x, -12.7],
	]);
	assert.deepEqual(ends(required(moved.find(({ id }) => id === 5))), [
		[20.32, -12.7],
		[20.32, 0],
	]);
});

test("wiring between parts moved together translates with them", () => {
	const first = pin(1, 0, 0);
	const second = pin(2, 20, 10);
	const shapes: EditorShape[] = [
		first,
		second,
		wire(3, 0, 0, 10, 0),
		wire(4, 10, 0, 10, 10),
		wire(5, 10, 10, 20, 10),
	];
	for (const delta of [
		{ x: 15, y: 0 },
		{ x: 5, y: 5 },
	]) {
		const moved = moveShapes([first, second], delta, 0, first, shapes);
		assert.deepEqual(
			visible(moved).map(ends),
			[
				[0, 0, 10, 0],
				[10, 0, 10, 10],
				[10, 10, 20, 10],
			].map(([x1, y1, x2, y2]) => [
				[x1 + delta.x, y1 + delta.y],
				[x2 + delta.x, y2 + delta.y],
			]),
		);
	}
});

/** A grid of resistors, each row chained by wires between neighbouring pins. */
function resistorGrid(rows: number, columns: number, dx: number, dy: number) {
	const shapes: EditorShape[] = [];
	let id = 1;
	for (let row = 0; row < rows; row++) {
		let previous: EditorShape | undefined;
		for (let column = 0; column < columns; column++) {
			const part = resistor(id++, column * dx, row * dy);
			shapes.push(part);
			if (previous) {
				const [left] = pinTerminals(part);
				const [, right] = pinTerminals(previous);
				shapes.push(wire(id++, right.x, right.y, left.x, left.y));
			}
			previous = part;
		}
	}
	return { shapes, nextId: id };
}

test("moves across a block of parts never join or split nets", () => {
	const { shapes, nextId: id } = resistorGrid(4, 4, 12.7, 7.62);
	const before = pinGroups(shapes);
	const parts = shapes.filter((shape) => shape.kind === "symbol");
	for (const part of [parts[5], parts[10], parts[0]])
		for (const delta of [
			{ x: 6.35, y: 3.81 },
			{ x: -12.7, y: 3.81 },
			{ x: 25.4, y: -11.43 },
		]) {
			const moved = moveShapes([part], delta, 1.27, part, shapes, id);
			assert.deepEqual(
				pinGroups(applyMove(shapes, moved)),
				before,
				`moving ${part.id} by ${delta.x},${delta.y}`,
			);
		}
});

test("a wire from a free waypoint is routed into the target pin from outside", () => {
	const part = resistor(1, 12.7, 0);
	const [left] = pinTerminals(part);
	const { points, clear } = routeWireConnection(
		createWireRoutingContext([part]),
		{ x: 0, y: -10.16 },
		left,
		{ pitch: 1.27, heading: 0 },
	);
	assert.ok(clear);
	assertOrthogonal(points);
	const before = required(points.at(-2));
	assert.ok(before.x < left.x && before.y === left.y);
});

test("a drag over other parts stays within its search budget", () => {
	const { shapes, nextId: id } = resistorGrid(12, 12, 10.16, 5.08);
	const row = shapes.filter(
		(shape) => shape.kind === "symbol" && Math.abs(shape.y - 25.4) < 1e-6,
	);
	moveShapes(row, { x: 1.27, y: 0 }, 1.27, row[0], shapes, id);
	const started = performance.now();
	for (let step = 2; step <= 12; step++)
		moveShapes(row, { x: 1.27 * step, y: 1.27 }, 1.27, row[0], shapes, id);
	const perStep = (performance.now() - started) / 11;
	assert.ok(perStep < 400, `took ${perStep.toFixed(0)} ms per step`);
});

test("random moves across a dense block never join or split nets", () => {
	const { shapes, nextId } = resistorGrid(8, 8, 10.16, 5.08);
	const before = pinGroups(shapes);
	const parts = shapes.filter((shape) => shape.kind === "symbol");
	// A fixed seed keeps the sweep repeatable.
	let seed = 7;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	for (let move = 0; move < 40; move++) {
		const count = 1 + Math.floor(random() * 3);
		const start = Math.floor(random() * (parts.length - count));
		const selection = parts.slice(start, start + count);
		// Half-pitch offsets keep moved pins off existing pins and wires, so
		// only routing could join nets.
		const delta = {
			x: (Math.floor(random() * 30) - 15) * 1.27 + 0.635,
			y: (Math.floor(random() * 20) - 10) * 1.27 + 0.635,
		};
		const moved = moveShapes(selection, delta, 0, selection[0], shapes, nextId);
		assert.deepEqual(
			pinGroups(applyMove(shapes, moved)),
			before,
			`move ${move}: ${selection.map(({ id }) => id)} by ${delta.x},${delta.y}`,
		);
	}
});

test("a fallback L prefers the orientation that touches no other pin", () => {
	const blocker = pin(9, 10, 0);
	const index = createWireRoutingContext([blocker]).index;
	const { points, routed, clear } = fallbackPath([index], {
		from: { point: { x: 0, y: 0 } },
		to: { point: { x: 20, y: 10 } },
		nets: new Set(),
	});
	assert.equal(routed, false);
	assert.ok(clear);
	assert.deepEqual(points[1], { x: 0, y: 10 });
});

const netLabel = (id: number, point: Point) => ({
	id,
	kind: "text" as const,
	x: point.x,
	y: point.y,
	width: 5,
	height: 2,
	fontSize: 1.27,
	rotation: 0,
	lineWidth: 0.2,
	text: "SIG",
	electrical: "net" as const,
});

test("a net label on a moved pin keeps one branch and the pin's wire follows", () => {
	const first = resistor(1, 0, 0);
	const second = resistor(2, 30.48, 10.16);
	const [, start] = pinTerminals(first);
	const [end] = pinTerminals(second);
	const shapes: EditorShape[] = [
		first,
		second,
		wire(3, start.x, start.y, 15.24, start.y),
		wire(4, 15.24, start.y, 15.24, end.y),
		wire(5, 15.24, end.y, end.x, end.y),
		netLabel(6, end),
	];
	const delta = { x: -17.78, y: 0 };
	const moved = moveShapes([second], delta, 1.27, second, shapes, 7);
	const after = applyMove(shapes, moved);
	assert.deepEqual(pinGroups(after), pinGroups(shapes));
	// The old Z is gone: nothing still runs along its last leg past the moved pin.
	for (const shape of after) {
		if (shape.kind !== "wire") continue;
		const [a, b] = resizeHandles(shape);
		assert.ok(
			Math.abs(a.y - end.y) > 1e-6 ||
				Math.abs(b.y - end.y) > 1e-6 ||
				Math.max(a.x, b.x) <= end.x + delta.x + 1e-6,
			`stale run ${JSON.stringify([a, b])}`,
		);
	}
});

test("a moved end without a lead never doubles back over its old wire", () => {
	const fixed = pin(1, 0, 0);
	const moving = pin(2, 10, 5);
	const shapes: EditorShape[] = [
		fixed,
		moving,
		wire(3, 0, 0, 5, 0),
		wire(4, 5, 0, 5, 5),
		wire(5, 5, 5, 10, 5),
	];
	const moved = moveShapes([moving], { x: -8, y: 0 }, 0, moving, shapes, 6);
	const after = applyMove(shapes, moved).filter(
		(shape) => shape.kind === "wire",
	);
	for (const shape of after) {
		const [a, b] = resizeHandles(shape);
		assert.ok(
			Math.max(a.x, b.x) <= 2 + 1e-6 || Math.abs(a.y - b.y) > 1e-6,
			`no horizontal run reaches past the pin: ${JSON.stringify([a, b])}`,
		);
	}
	assert.deepEqual(pinGroups(applyMove(shapes, moved)), pinGroups(shapes));
});

test("dropping a wired pin onto another net's wire is the user's connection, not an unsafe route", () => {
	const fixed = pin(1, 0, 0);
	const moving = pin(2, 10, 0);
	const shapes: EditorShape[] = [
		fixed,
		moving,
		wire(3, 0, 0, 10, 0),
		wire(4, 20, -10, 20, 10),
	];
	const moved = moveShapes([moving], { x: 10, y: 5 }, 0, moving, shapes, 5);
	assert.equal(isUnsafeMove(moved), false);
	assert.equal(
		isUnsafeMove(moveShapes([moving], { x: 0, y: 5 }, 0, moving, shapes, 5)),
		false,
	);
});

test("a move whose only route crosses other pins is marked unsafe", () => {
	const fixed = pin(1, 0, 0);
	const moving = pin(2, 25.4, 0);
	const target = { x: 25.4, y: 12.7 };
	const fence = [
		[1.27, 0],
		[-1.27, 0],
		[0, 1.27],
		[0, -1.27],
	].map(([dx, dy], index) => pin(10 + index, target.x + dx, target.y + dy));
	const shapes: EditorShape[] = [
		fixed,
		moving,
		wire(3, 0, 0, 25.4, 0),
		...fence,
	];
	const moved = withFullRouting(() =>
		moveShapes([moving], { x: 0, y: 12.7 }, 1.27, moving, shapes, 20),
	);
	assert.equal(isUnsafeMove(moved), true);
});

test("a committed move routes past the preview budget instead of refusing", () => {
	const shapes: EditorShape[] = [];
	const moving: EditorShape[] = [];
	for (let index = 0; index < 16; index++) {
		const y = 2.54 * index;
		const free = pin(1 + index, 0, y);
		moving.push(free);
		shapes.push(
			free,
			pin(100 + index, 101.6, y),
			wire(200 + index, 0, y, 101.6, y),
		);
	}
	for (let index = 0; index < 30; index++)
		shapes.push(pin(300 + index, 50.8, -2.54 * (index + 1)));
	// The preview budget cannot find every route, which is why commits lift it.
	assert.equal(
		isUnsafeMove(
			moveShapes(moving, { x: 0, y: -20.32 }, 1.27, moving[0], shapes, 400),
		),
		true,
	);
	const commit = withFullRouting(() =>
		moveShapes(moving, { x: 0, y: -20.32 }, 1.27, moving[0], shapes, 400),
	);
	assert.equal(isUnsafeMove(commit), false);
	assert.deepEqual(pinGroups(applyMove(shapes, commit)), pinGroups(shapes));
});

test("rerouted wires keep their width and line pattern", () => {
	const first = resistor(1, 0, 0);
	const second = resistor(2, 25.4, 0);
	const [, start] = pinTerminals(first);
	const [end] = pinTerminals(second);
	const styled = {
		...wire(3, start.x, start.y, end.x, end.y),
		lineWidth: 0.4,
		lineStyle: "dashed" as const,
	};
	const moved = moveShapes(
		[second],
		{ x: 0, y: 12.7 },
		1.27,
		second,
		[first, second, styled],
		4,
	);
	const wires = visible(moved);
	assert.ok(wires.length > 1);
	for (const shape of wires) {
		assert.equal(shape.lineWidth, 0.4);
		assert.equal((shape as typeof styled).lineStyle, "dashed");
	}
});

test("a route goes as far around an obstacle as it needs to", () => {
	// A long foreign-pin wall leaves only a detour far outside the end bounds.
	const wall = Array.from({ length: 160 }, (_, index) =>
		pin(10 + index, 10.16, -101.6 + 1.27 * index),
	);
	const context = createWireRoutingContext(wall);
	const { points, clear } = routeWireConnection(
		context,
		{ x: 0, y: 0 },
		{ x: 20.32, y: 0 },
		{ pitch: 1.27 },
	);
	assert.ok(clear);
	assert.ok(points.some(({ y }) => Math.abs(y) > 90));
});
