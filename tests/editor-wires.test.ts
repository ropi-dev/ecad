import assert from "node:assert/strict";
import { test } from "node:test";
import {
	drawShape,
	type EditorShape,
	findWireConnection,
	hitShape,
	intersectsSelection,
	moveShapes,
	openPins,
	pinTerminals,
	resizeHandles,
	routeWire,
	wireConnectionPoints,
} from "#/components/editor/shapes.ts";
import {
	createSymbol,
	symbolDefinitions,
} from "#/components/editor/symbols.ts";

const pin = (id: number, x: number, y: number) =>
	drawShape(id, "pin", { x, y }, { x, y });
const wire = (id: number, x: number, y: number, endX: number, endY: number) =>
	drawShape(id, "wire", { x, y }, { x: endX, y: endY });

const endpoints = (shape: EditorShape) => resizeHandles(shape).map(({ x, y }) => [
	Number(x.toFixed(6)), Number(y.toFixed(6)),
]);

test("moving a symbol carries both pin connections and stretches neighboring segments", () => {
	const symbol = createSymbol(1, symbolDefinitions[0], { x: 50, y: 60 });
	const [left, right] = pinTerminals(symbol);
	const shapes = [symbol, wire(2, 20, 60, left.x, left.y),
		wire(3, right.x, right.y, 80, 60), wire(4, 80, 60, 80, 100),
		wire(5, 150, 60, 180, 60)];
	const original = structuredClone(shapes);
	const moved = moveShapes([symbol], { x: 10, y: 15 }, 0, symbol, shapes);
	assert.deepEqual(moved.map(({ id }) => id), [1, 2, 3, 4]);
	assert.deepEqual(pinTerminals(moved[0]), [{ x: left.x + 10, y: 75 }, { x: right.x + 10, y: 75 }]);
	assert.deepEqual(endpoints(moved[1]), [[20, 75], [left.x + 10, 75]]);
	assert.deepEqual(endpoints(moved[2]), [[right.x + 10, 75], [80, 75]]);
	assert.deepEqual(endpoints(moved[3]), [[80, 75], [80, 100]]);
	assert.deepEqual(shapes, original);
	assert.deepEqual(moveShapes([symbol], { x: 0, y: 0 }, 0, symbol, shapes), shapes.slice(0, 4));
});

test("rotated symbol pins use the same snapped delta as selected wires", () => {
	const symbol = { ...createSymbol(1, symbolDefinitions[0], { x: 51, y: 61 }), rotation: Math.PI / 2 };
	const [, top] = pinTerminals(symbol);
	const attached = wire(2, top.x, top.y, 51, 100);
	const neighbor = wire(3, 51, 100, 90, 100);
	const symbolOnly = moveShapes([symbol], { x: 12, y: 12 }, 10, symbol, [symbol, attached, neighbor]);
	assert.deepEqual(endpoints(symbolOnly[1]), [[60, top.y + 9], [60, 100]]);
	assert.deepEqual(endpoints(symbolOnly[2]), [[60, 100], [90, 100]]);
	const moved = moveShapes([symbol, attached], { x: 12, y: 12 }, 10, symbol, [symbol, attached, neighbor]);
	assert.deepEqual(pinTerminals(moved[0])[1], { x: 60, y: top.y + 9 });
	assert.deepEqual(endpoints(moved[1]), [[60, top.y + 9], [60, 109]]);
	assert.deepEqual(endpoints(moved[2]), [[60, 109], [90, 109]]);
});

test("moving a pin attached inside a wire preserves the junction and rejects detachment", () => {
	const terminal = pin(1, 50, 0);
	const trunk = wire(2, 0, 0, 100, 0);
	const shapes = [terminal, trunk];
	const moved = moveShapes([terminal], { x: 20, y: 10 }, 0, terminal, shapes);
	assert.deepEqual(pinTerminals(moved[0]), [{ x: 70, y: 10 }]);
	assert.deepEqual(endpoints(moved[1]), [[0, 10], [100, 10]]);
	assert.deepEqual(moveShapes([terminal], { x: 60, y: 10 }, 0, terminal, shapes), shapes);
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

test("empty space and ordinary shapes are not wire anchors", () => {
	const rectangle = drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 20, y: 20 });
	assert.equal(findWireConnection([], { x: 10, y: 10 }, 2), undefined);
	assert.deepEqual(wireConnectionPoints([rectangle]), []);
});

test("nearby pin queries preserve connectivity checks against the whole drawing", () => {
	const symbol = { ...createSymbol(6, symbolDefinitions[0], { x: 60, y: 10 }), rotation: Math.PI / 2 };
	const shapes = [pin(1, 10, 10), wire(2, 0, 10, 20, 10), pin(3, 30, 10),
		pin(4, 40, 10), pin(5, 40, 10), symbol];
	for (const point of [{ x: 10, y: 10 }, { x: 30.1, y: 10 }, { x: 40, y: 10 },
		{ x: 60, y: 13 }, { x: 100, y: 100 }]) {
		assert.deepEqual(openPins(shapes, { point, tolerance: 1 }),
			openPins(shapes).filter(({ point: pin }) => Math.hypot(pin.x - point.x, pin.y - point.y) <= 1));
	}
	assert.equal(openPins(shapes, { point: { x: 30.1, y: 10 }, tolerance: 1 })[0].shape, shapes[2]);
	assert.deepEqual(openPins(shapes, { point: { x: 10, y: 10 }, tolerance: 1 }), []);
	assert.deepEqual(openPins(shapes, { point: { x: 40, y: 10 }, tolerance: 1 }), []);
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
		{ x: 50, y: 57 },
		{ x: 50, y: 63 },
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
