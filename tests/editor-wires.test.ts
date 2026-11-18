import assert from "node:assert/strict";
import { test } from "node:test";
import {
	drawShape,
	type EditorShape,
	findWireConnection,
	hitShape,
	intersectsSelection,
	moveShapes,
	pinTerminals,
	resizeHandles,
	routeWire,
	wireConnectionPoints,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	createSymbol,
	symbolDefinitions,
} from "#/components/editor/symbols.ts";
import { required } from "./helpers/required.ts";

const pin = (id: number, x: number, y: number) =>
	drawShape(id, "pin", { x, y }, { x, y });
const wire = (id: number, x: number, y: number, endX: number, endY: number) =>
	drawShape(id, "wire", { x, y }, { x: endX, y: endY });

const endpoints = (shape: EditorShape) =>
	resizeHandles(shape).map(({ x, y }) => [
		Number(x.toFixed(6)),
		Number(y.toFixed(6)),
	]);

const visibleWires = (shapes: EditorShape[]) =>
	shapes.filter((shape) => shape.kind === "wire" && shape.width > 1e-4);

/** Walks wires from `from` to `to` and returns the path's points and wires. */
function assertPath(wires: EditorShape[], from: Point, to: Point) {
	const round = (point: Point) =>
		[point.x, point.y].map((value) => Number(value.toFixed(6)));
	const key = ([x, y]: number[]) => `${x},${y}`;
	const remaining = wires.map((shape) => ({ shape, ends: endpoints(shape) }));
	for (const { ends } of remaining) {
		const [[x1, y1], [x2, y2]] = ends;
		assert.ok(x1 === x2 || y1 === y2, "wire segments stay orthogonal");
	}
	const points = [round(from)];
	const used: EditorShape[] = [];
	while (key(points.at(-1) ?? []) !== key(round(to))) {
		const current = key(points.at(-1) ?? []);
		const index = remaining.findIndex(
			({ ends: [start, end] }) =>
				key(start) === current || key(end) === current,
		);
		assert.ok(index >= 0, `path continues from ${current}`);
		const {
			shape,
			ends: [start, end],
		} = remaining.splice(index, 1)[0];
		used.push(shape);
		points.push(key(start) === current ? end : start);
	}
	return { points, used };
}

test("moving a symbol reroutes wires to fixed pins without keeping the old geometry", () => {
	const symbol = createSymbol(1, symbolDefinitions[0], { x: 50, y: 60 });
	const [left, right] = pinTerminals(symbol);
	const shapes = [
		symbol,
		pin(10, 20, 60),
		pin(11, 80, 100),
		wire(2, 20, 60, left.x, left.y),
		wire(3, right.x, right.y, 80, 60),
		wire(4, 80, 60, 80, 100),
		wire(5, 150, 60, 180, 60),
	];
	const original = structuredClone(shapes);
	for (const delta of [
		{ x: 10, y: 15 },
		{ x: -10, y: -15 },
		{ x: 10, y: -15 },
		{ x: -10, y: 15 },
	]) {
		const moved = moveShapes([symbol], delta, 0, symbol, shapes);
		const [newLeft, newRight] = pinTerminals(moved[0]);
		assert.deepEqual(
			[newLeft, newRight],
			[left, right].map((point) => ({
				x: point.x + delta.x,
				y: point.y + delta.y,
			})),
		);
		assert.ok(!moved.some((shape) => shape.id === 5));
		const wires = visibleWires(moved);
		// Each fixed pin keeps exactly one path to the pin that moved.
		const leftPath = assertPath(wires, { x: 20, y: 60 }, newLeft);
		const leftEnd = leftPath.points.at(-2) ?? [];
		assert.equal(
			leftEnd[1],
			newLeft.y,
			"the route enters the pin horizontally",
		);
		assert.ok(leftEnd[0] < newLeft.x, "the route enters the pin from outside");
		const rightPath = assertPath(wires, newRight, { x: 80, y: 100 });
		assert.equal(
			leftPath.used.length + rightPath.used.length,
			wires.length,
			"no stale wire remains",
		);
	}
	assert.deepEqual(shapes, original);
	assert.deepEqual(moveShapes([symbol], { x: 0, y: 0 }, 0, symbol, shapes), [
		symbol,
	]);
});

test("moving a symbol stretches a stub that ends in the open", () => {
	const symbol = createSymbol(1, symbolDefinitions[0], { x: 50, y: 60 });
	const [, right] = pinTerminals(symbol);
	const shapes = [
		symbol,
		wire(2, right.x, right.y, 80, 60),
		wire(3, 80, 60, 80, 100),
	];
	const moved = moveShapes([symbol], { x: 10, y: 15 }, 0, symbol, shapes);
	assert.deepEqual(
		moved.map(({ id }) => id),
		[1, 2, 3],
	);
	assert.deepEqual(endpoints(moved[1]), [
		[right.x + 10, 75],
		[80, 75],
	]);
	assert.deepEqual(endpoints(moved[2]), [
		[80, 75],
		[80, 100],
	]);
});

test("moving a pin from a wire interior keeps the wire and branches to it", () => {
	const terminal = pin(1, 50, 0);
	const trunk = wire(2, 0, 0, 100, 0);
	const shapes = [terminal, trunk];
	const moved = moveShapes([terminal], { x: 60, y: 10 }, 0, terminal, shapes);
	assert.deepEqual(pinTerminals(moved[0]), [{ x: 110, y: 10 }]);
	assert.ok(!moved.some((shape) => shape.id === 2));
	const branch = visibleWires(moved);
	assert.equal(
		assertPath(branch, { x: 50, y: 0 }, { x: 110, y: 10 }).used.length,
		branch.length,
	);
	assert.deepEqual(endpoints(trunk), [
		[0, 0],
		[100, 0],
	]);
});

test("moving away from a component pin leaves along its lead and avoids its body", () => {
	const first = pin(1, 20, 20);
	const other = createSymbol(2, symbolDefinitions[0], { x: 23.81, y: 20 });
	for (const delta of [
		{ x: 10, y: 0 },
		{ x: 0, y: -10 },
		{ x: -10, y: 20 },
	]) {
		const moved = moveShapes([first], delta, 0, first, [first, other], 50);
		assert.equal(moved[1].id, 50);
		const { points } = assertPath(
			moved.slice(1),
			{ x: 20, y: 20 },
			{ x: 20 + delta.x, y: 20 + delta.y },
		);
		assert.ok(points[1][0] < 20 && points[1][1] === 20, "leaves leftwards");
		assert.deepEqual(pinTerminals(other)[0], { x: 20, y: 20 });
	}
	assert.equal(moveShapes([first, other], { x: 10, y: 20 }).length, 2);
});

test("pins have one terminal, snap by that terminal, and select without resize handles", () => {
	const shape = pin(1, 12, 13);
	assert.deepEqual(pinTerminals(shape), [{ x: 12, y: 13 }]);
	assert.deepEqual(resizeHandles(shape), []);
	assert.equal(hitShape(shape, { x: 12, y: 13 }, 0), true);
	assert.equal(hitShape(shape, { x: 14, y: 15 }, 0), false);
	assert.equal(
		intersectsSelection(shape, {
			minX: 11.5,
			maxX: 12.5,
			minY: 12.5,
			maxY: 13.5,
		}),
		true,
	);
	assert.deepEqual(pinTerminals(moveShapes([shape], { x: 5, y: 5 }, 5)[0]), [
		{ x: 15, y: 20 },
	]);
});

test("symbols expose only their external pins, including after rotation", () => {
	const symbol = {
		...createSymbol(1, symbolDefinitions[0], { x: 50, y: 60 }),
		rotation: Math.PI / 2,
	};
	assert.deepEqual(pinTerminals(symbol), [
		{ x: 50, y: 56.19 },
		{ x: 50, y: 63.81 },
	]);
	assert.deepEqual(wireConnectionPoints([symbol]), pinTerminals(symbol));
	assert.equal(findWireConnection([symbol], { x: 50, y: 50 }, 1), undefined);
});

test("routing to an offset terminal inserts an exact orthogonal bend", () => {
	const segments = routeWire(1, { x: 13, y: 17 }, { x: 54, y: 38 });
	assert.deepEqual(
		segments.map(({ id, x, y, width, rotation }) => ({
			id,
			x,
			y,
			width,
			rotation,
		})),
		[
			{ id: 1, x: 33.5, y: 17, width: 41, rotation: 0 },
			{ id: 2, x: 54, y: 27.5, width: 21, rotation: Math.PI / 2 },
		],
	);
	assert.deepEqual(wireConnectionPoints(segments), [
		{ x: 13, y: 17 },
		{ x: 54, y: 38 },
	]);
	assert.equal(routeWire(1, { x: 13, y: 17 }, { x: 54, y: 17 }).length, 1);
});

test("wire snapping projects onto horizontal and reversed vertical interiors", () => {
	assert.deepEqual(
		findWireConnection([wire(1, 100, 40, 0, 40)], { x: 35, y: 41 }, 2),
		{ x: 35, y: 40 },
	);
	assert.deepEqual(
		findWireConnection([wire(1, 20, 100, 20, 0)], { x: 21, y: 35 }, 2),
		{ x: 20, y: 35 },
	);
	assert.equal(
		findWireConnection([wire(1, 0, 0, 100, 0)], { x: 50, y: 3 }, 2),
		undefined,
	);
	assert.equal(
		findWireConnection([wire(1, 0, 0, 100, 0)], { x: 50, y: 0 }, 2, {
			x: 50,
			y: 0,
		}),
		undefined,
	);
	assert.deepEqual(
		findWireConnection(
			[wire(1, 0, 0, 100, 0), pin(2, 50, 1)],
			{ x: 50, y: 0.1 },
			2,
		),
		{ x: 50, y: 1 },
	);
});

for (const electrical of ["net", "supply"] as const) {
	test(`moving a ${electrical} label preserves pin and wire connections`, () => {
		const label = {
			...drawShape(1, "rectangle", { x: 20, y: 20 }, { x: 20, y: 20 }),
			kind: "text" as const,
			text: "VDD",
			fontSize: 1.3,
			electrical,
		};
		for (const neighbor of [pin(2, 20, 20), wire(2, 0, 20, 40, 20)]) {
			const shapes = [label, neighbor];
			const moved = moveShapes([label], { x: 10, y: 15 }, 0, label, shapes);
			assert.equal(moved[0].x, 30);
			assert.equal(moved[0].y, 35);
			assert.deepEqual(endpoints(moved[1])[0], [20, 20]);
			assert.deepEqual(endpoints(required(moved.at(-1)))[1], [30, 35]);
			const movedPin = moveShapes(
				[neighbor],
				{ x: 10, y: 15 },
				0,
				neighbor,
				shapes,
			);
			if (neighbor.kind === "pin") assert.equal(movedPin.length, 3);
		}
		assert.equal(moveShapes([label], { x: 10, y: 15 }).length, 1);
		assert.equal(
			moveShapes([label, pin(2, 20, 20)], { x: 10, y: 15 }).length,
			2,
		);
		assert.equal(
			moveShapes(
				[{ ...label, electrical: undefined }],
				{ x: 10, y: 15 },
				0,
				label,
				[label, pin(2, 20, 20)],
			).length,
			1,
		);
	});
}
