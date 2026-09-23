import assert from "node:assert/strict";
import { test } from "node:test";
import {
	drawShape,
	findWireConnection,
	hitShape,
	intersectsSelection,
	moveShapes,
	pinTerminals,
	resizeHandles,
	routeWire,
	wireConnectionPoints,
} from "../src/components/editor/shapes.ts";
import {
	createSymbol,
	symbolDefinitions,
} from "../src/components/editor/symbols.ts";

const pin = (id: number, x: number, y: number) =>
	drawShape(id, "pin", { x, y }, { x, y });
const wire = (id: number, x: number, y: number, endX: number, endY: number) =>
	drawShape(id, "wire", { x, y }, { x: endX, y: endY });

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

test("empty space and ordinary shapes are not wire anchors", () => {
	const rectangle = drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 20, y: 20 });
	assert.equal(findWireConnection([], { x: 10, y: 10 }, 2), undefined);
	assert.deepEqual(wireConnectionPoints([rectangle]), []);
});

test("only open wire ends and pins are connection points, not corners or segment interiors", () => {
	const shapes = [pin(1, 0, 0), wire(2, 0, 0, 20, 0), wire(3, 20, 0, 20, 20)];
	assert.deepEqual(wireConnectionPoints(shapes), [
		{ x: 0, y: 0 },
		{ x: 20, y: 20 },
	]);
	assert.equal(findWireConnection(shapes, { x: 10, y: 0 }, 2), undefined);
	assert.equal(findWireConnection(shapes, { x: 20, y: 0 }, 2), undefined);
	assert.deepEqual(findWireConnection(shapes, { x: 21, y: 20 }, 2), {
		x: 20,
		y: 20,
	});
	// An end touching another wire's interior is no longer open.
	assert.equal(
		wireConnectionPoints([...shapes, wire(4, 10, 0, 10, 10)]).some(
			(p) => p.x === 10 && p.y === 0,
		),
		false,
	);
});

test("connections remain exact off-grid and exclude the active start", () => {
	const shapes = [pin(1, 13, 17), wire(2, 30, 17, 40, 17)];
	assert.deepEqual(findWireConnection(shapes, { x: 13.2, y: 17.1 }, 2), {
		x: 13,
		y: 17,
	});
	assert.deepEqual(
		findWireConnection(shapes, { x: 13.2, y: 17.1 }, 2, { x: 30, y: 17 }),
		{ x: 13, y: 17 },
	);
	assert.deepEqual(
		findWireConnection(shapes, { x: 13, y: 17 }, 2, { x: 30, y: 20 }),
		{ x: 13, y: 17 },
	);
	assert.equal(
		findWireConnection(shapes, { x: 13, y: 17 }, 2, { x: 13, y: 17 }),
		undefined,
	);
});

test("symbols expose only their external pins, including after rotation", () => {
	const symbol = {
		...createSymbol(1, symbolDefinitions[0], { x: 50, y: 60 }),
		rotation: Math.PI / 2,
	};
	assert.deepEqual(pinTerminals(symbol), [
		{ x: 50, y: 57.1875 },
		{ x: 50, y: 62.8125 },
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
