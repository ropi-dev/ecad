import assert from "node:assert/strict";
import test from "node:test";
import {
	drawShape,
	type EditorShape,
	netLabelAnchors,
	openPins,
	openWireEnds,
	PIN_RADIUS,
	pinTerminals,
	resizeHandles,
	symbolShapes,
	wireJunctions,
} from "#/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import type { Point } from "#/drawing/types.ts";
import {
	buildWireCrossings,
	type WireCrossings,
} from "#/drawing/wire-crossings.ts";

// The connection analyses use spatial indexes. These copies of the original
// all-pairs scans define the expected results, including tolerance boundaries.
const connectionTolerance = 1e-4;

function localToWorld(shape: EditorShape, x: number, y: number): Point {
	return {
		x: shape.x + x * Math.cos(shape.rotation) - y * Math.sin(shape.rotation),
		y: shape.y + x * Math.sin(shape.rotation) + y * Math.cos(shape.rotation),
	};
}

function pointOnWire(point: Point, start: Point, end: Point) {
	const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
	const along = vertical ? "y" : "x";
	const across = vertical ? "x" : "y";
	return (
		Math.abs(point[across] - start[across]) <= connectionTolerance &&
		point[along] >= Math.min(start[along], end[along]) - connectionTolerance &&
		point[along] <= Math.max(start[along], end[along]) + connectionTolerance
	);
}

function referenceOpenPins(
	shapes: EditorShape[],
	near?: { point: Point; tolerance: number },
) {
	const pins = shapes.flatMap((shape) =>
		pinTerminals(shape).map((point) => ({ shape, point })),
	);
	// Check connectivity only for pins within the pointer's hit area.
	const candidates = near
		? pins.filter(
				({ point }) =>
					Math.hypot(point.x - near.point.x, point.y - near.point.y) <=
					near.tolerance,
			)
		: pins;
	if (candidates.length === 0) return [];
	const wires = shapes
		.filter((shape) => shape.kind === "wire")
		.map((shape) => ({
			start: localToWorld(shape, -shape.width / 2, 0),
			end: localToWorld(shape, shape.width / 2, 0),
		}));
	const noConnects = shapes.flatMap((shape) =>
		shape.kind === "symbol"
			? symbolShapes(shape).filter((child) => child.kind === "no-connect")
			: shape.kind === "no-connect"
				? [shape]
				: [],
	);
	return candidates.filter(
		(pin) =>
			!noConnects.some(
				(shape) =>
					Math.hypot(shape.x - pin.point.x, shape.y - pin.point.y) <=
					connectionTolerance,
			) &&
			!wires.some(({ start, end }) => pointOnWire(pin.point, start, end)) &&
			!pins.some(
				(other) =>
					other !== pin &&
					Math.hypot(
						other.point.x - pin.point.x,
						other.point.y - pin.point.y,
					) <= connectionTolerance,
			),
	);
}

function referenceOpenWireEnds(shapes: EditorShape[]) {
	const pins = [...shapes.flatMap(pinTerminals), ...netLabelAnchors(shapes)];
	const wires = shapes
		.filter((shape) => shape.kind === "wire")
		.map((shape) => ({
			shape,
			start: localToWorld(shape, -shape.width / 2, 0),
			end: localToWorld(shape, shape.width / 2, 0),
		}));
	return wires.flatMap((wire) =>
		[wire.start, wire.end]
			.filter(
				(point) =>
					!pins.some(
						(pin) =>
							Math.hypot(pin.x - point.x, pin.y - point.y) <=
							connectionTolerance,
					) &&
					!wires.some(
						(other) =>
							other !== wire && pointOnWire(point, other.start, other.end),
					),
			)
			.map((point) => ({ shape: wire.shape, point })),
	);
}

function referenceWireJunctions(shapes: EditorShape[]) {
	const wires = shapes.flatMap((shape) => {
		if (shape.kind !== "wire" || shape.width <= connectionTolerance) return [];
		const start = localToWorld(shape, -shape.width / 2, 0);
		const end = localToWorld(shape, shape.width / 2, 0);
		return [{ shape, start, end }];
	});
	const axes = [
		new Map<number, typeof wires>(),
		new Map<number, typeof wires>(),
	];
	const bucket = (value: number) => Math.floor(value / connectionTolerance);
	for (const wire of wires) {
		const vertical =
			Math.abs(wire.end.x - wire.start.x) < Math.abs(wire.end.y - wire.start.y);
		const index = axes[vertical ? 0 : 1];
		const key = bucket(vertical ? wire.start.x : wire.start.y);
		const entries = index.get(key) ?? [];
		entries.push(wire);
		index.set(key, entries);
	}
	const candidates = new Map<string, { point: Point; pins: EditorShape[] }[]>();
	const atPoint = (point: Point) => {
		const x = bucket(point.x);
		const y = bucket(point.y);
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const existing = candidates
					.get(`${x + dx}:${y + dy}`)
					?.find(
						(candidate) =>
							Math.hypot(
								candidate.point.x - point.x,
								candidate.point.y - point.y,
							) <= connectionTolerance,
					);
				if (existing) return existing;
			}
		}
		const candidate = { point, pins: [] as EditorShape[] };
		const key = `${x}:${y}`;
		const entries = candidates.get(key) ?? [];
		entries.push(candidate);
		candidates.set(key, entries);
		return candidate;
	};
	for (const shape of shapes) {
		for (const point of pinTerminals(shape)) atPoint(point).pins.push(shape);
	}
	for (const { start, end } of wires) {
		atPoint(start);
		atPoint(end);
	}
	return [...candidates.values()].flat().flatMap(({ point, pins }) => {
		let branches = pins.length;
		const connected = [...pins];
		for (const [axis, coordinate] of [point.x, point.y].entries()) {
			const key = bucket(coordinate);
			for (let offset = -1; offset <= 1; offset++) {
				for (const wire of axes[axis].get(key + offset) ?? []) {
					if (!pointOnWire(point, wire.start, wire.end)) continue;
					const atEnd = [wire.start, wire.end].some(
						(end) =>
							Math.hypot(end.x - point.x, end.y - point.y) <=
							connectionTolerance,
					);
					branches += atEnd ? 1 : 2;
					connected.push(wire.shape);
				}
			}
		}
		return branches >= 3 ? [{ point, shapes: connected }] : [];
	});
}

function referenceWireCrossings(shapes: EditorShape[], junctions: Point[]) {
	const tolerance = 1e-4;
	const wires = shapes.flatMap((shape) => {
		if (shape.kind !== "wire" || shape.width <= tolerance) return [];
		const [start, end] = resizeHandles(shape);
		const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
		const axis = vertical ? "y" : "x";
		return [
			{
				shape,
				vertical,
				min: Math.min(start[axis], end[axis]),
				max: Math.max(start[axis], end[axis]),
				direction: end[axis] >= start[axis] ? 1 : -1,
			},
		];
	});
	const verticals = wires.filter((wire) => wire.vertical);
	const result = new Map<number, WireCrossings>();
	const forWire = (id: number) => {
		let crossing = result.get(id);
		if (!crossing) {
			crossing = { bridges: [], gaps: [] };
			result.set(id, crossing);
		}
		return crossing;
	};
	for (const horizontal of wires) {
		if (horizontal.vertical) continue;
		const { shape, min, max, direction } = horizontal;
		const crossings = verticals
			.filter(
				(vertical) =>
					vertical.shape.x > min + tolerance &&
					vertical.shape.x < max - tolerance &&
					shape.y > vertical.min + tolerance &&
					shape.y < vertical.max - tolerance &&
					!junctions.some(
						(point) =>
							Math.hypot(point.x - vertical.shape.x, point.y - shape.y) <=
							tolerance,
					),
			)
			.map((vertical) => {
				const x = vertical.shape.x;
				const radius = Math.min(
					Math.max(
						PIN_RADIUS * 3,
						shape.lineWidth * 2,
						vertical.shape.lineWidth * 2,
					),
					x - min,
					max - x,
					...junctions
						.filter((point) => Math.abs(point.y - shape.y) <= tolerance)
						.map((point) => Math.abs(point.x - x) / 2),
				);
				return { start: x - radius, end: x + radius, verticals: [vertical] };
			})
			.sort((a, b) => a.start - b.start);
		const groups: typeof crossings = [];
		for (const crossing of crossings) {
			const previous = groups.at(-1);
			if (previous && crossing.start <= previous.end + tolerance) {
				previous.end = Math.max(previous.end, crossing.end);
				previous.verticals.push(...crossing.verticals);
			} else groups.push(crossing);
		}
		for (const group of groups) {
			const center = (group.start + group.end) / 2;
			const radius = (group.end - group.start) / 2;
			forWire(shape.id).bridges.push({
				offset: (center - shape.x) * direction,
				radius,
				side: direction,
			});
			for (const vertical of group.verticals) {
				const dx = vertical.shape.x - center;
				const y = shape.y + Math.sqrt(Math.max(0, radius * radius - dx * dx));
				const offset = (y - vertical.shape.y) * vertical.direction;
				const clearance =
					(shape.lineWidth + vertical.shape.lineWidth) / 2 + PIN_RADIUS / 2;
				forWire(vertical.shape.id).gaps.push({
					start: offset - clearance,
					end: offset + clearance,
				});
			}
		}
	}
	return result;
}

/** Deterministic drawings with coincident, nearly coincident, and crossing items. */
function randomDrawing(seed: number): EditorShape[] {
	let state = seed;
	const random = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	const pick = <T>(items: readonly T[]) =>
		items[Math.floor(random() * items.length)];
	const nudges = [
		0, 0, 0, 0, 0.5e-4, -0.5e-4, 1e-4, -1e-4, 1.5e-4, -1.5e-4, 0.3,
	];
	const coordinate = () => Math.round(random() * 16 - 8) * 1.27 + pick(nudges);
	const point = () => ({ x: coordinate(), y: coordinate() });
	const parts = ["resistor", "capacitor", "led", "connector-4"].map(
		(id) => symbolDefinitions.find((definition) => definition.id === id)!,
	);
	const shapes: EditorShape[] = [];
	for (let id = 1; shapes.length < 70; id++) {
		const kind = random();
		const start = point();
		if (kind < 0.5) {
			const length = Math.round(random() * 12 - 6) * 1.27 + pick(nudges);
			const shape = random();
			const end =
				shape < 0.45
					? { x: start.x + length, y: start.y + pick(nudges) }
					: shape < 0.9
						? { x: start.x + pick(nudges), y: start.y + length }
						: point();
			shapes.push(drawShape(id, "wire", start, end));
		} else if (kind < 0.65) shapes.push(drawShape(id, "pin", start, start));
		else if (kind < 0.8)
			shapes.push({
				...createSymbol(id, pick(parts), start),
				rotation: (Math.PI / 2) * Math.floor(random() * 4),
			});
		else if (kind < 0.88)
			shapes.push(drawShape(id, "no-connect", start, start));
		else
			shapes.push({
				id,
				kind: "text",
				...start,
				width: 4,
				height: 1.905,
				rotation: 0,
				lineWidth: 0.254,
				fontSize: 1.27,
				text: random() < 0.8 ? "NET" : " ",
				electrical: "net",
			});
	}
	return shapes;
}

const ids = (items: { shape: EditorShape }[]) =>
	items.map(({ shape, ...rest }) => ({ id: shape.id, ...rest }));

test("indexed connection analyses match the all-pairs scans", () => {
	for (let seed = 1; seed <= 400; seed++) {
		const shapes = randomDrawing(seed);
		const message = `seed ${seed}`;
		assert.deepEqual(
			ids(openPins(shapes)),
			ids(referenceOpenPins(shapes)),
			message,
		);
		const near = { point: shapes[seed % shapes.length], tolerance: 2 };
		assert.deepEqual(
			ids(
				openPins(shapes, {
					point: { x: near.point.x, y: near.point.y },
					tolerance: near.tolerance,
				}),
			),
			ids(
				referenceOpenPins(shapes, {
					point: { x: near.point.x, y: near.point.y },
					tolerance: near.tolerance,
				}),
			),
			message,
		);
		assert.deepEqual(
			ids(openWireEnds(shapes)),
			ids(referenceOpenWireEnds(shapes)),
			message,
		);
		const junctions = wireJunctions(shapes);
		const expected = referenceWireJunctions(shapes);
		assert.deepEqual(
			junctions.map(({ point, shapes }) => ({
				point,
				ids: shapes.map(({ id }) => id),
			})),
			expected.map(({ point, shapes }) => ({
				point,
				ids: shapes.map(({ id }) => id),
			})),
			message,
		);
		const points = expected.map(({ point }) => point);
		assert.deepEqual(
			[...buildWireCrossings(shapes, points)],
			[...referenceWireCrossings(shapes, points)],
			message,
		);
	}
});

test("crossing lookups match the full scan for long wires and dense junction rows", () => {
	const wire = (id: number, x: number, y: number, endX: number, endY: number) =>
		drawShape(id, "wire", { x, y }, { x: endX, y: endY });
	const shapes: EditorShape[] = [
		wire(1, -50_000, 0, 50_000, 0),
		wire(2, 0, -40_000, 0, 40_000),
		wire(3, 10, -1, 10, 1),
		wire(4, 10.0002, -1, 10.0002, 1),
		wire(5, -20, 0.00005, 20, 0.00005),
		...Array.from({ length: 40 }, (_, index) =>
			wire(6 + index, index * 0.7 - 14, -3, index * 0.7 - 14, 3),
		),
	];
	const junctions: Point[] = [
		...Array.from({ length: 30 }, (_, index) => ({
			x: index * 0.9 - 13,
			y: 0,
		})),
		{ x: 10.0001, y: 0.00009 },
		{ x: 3, y: 0.0002 },
	];
	assert.deepEqual(
		[...buildWireCrossings(shapes, junctions)],
		[...referenceWireCrossings(shapes, junctions)],
	);
	const unsorted = [...junctions, { x: Number.NaN, y: 0 }];
	assert.deepEqual(
		[...buildWireCrossings(shapes, unsorted)],
		[...referenceWireCrossings(shapes, unsorted)],
	);
});

test("crossings stay exact and finish at very large coordinates", () => {
	const wire = (id: number, x: number, y: number, endX: number, endY: number) =>
		drawShape(id, "wire", { x, y }, { x: endX, y: endY });
	// Near 2^53 and beyond, x ± tolerance rounds to x and integer keys stop advancing.
	for (let power = 0; power <= 62; power++) {
		const x = 2 ** power;
		for (const [shapes, junctions] of [
			[[wire(1, -2 * x, 0, 2 * x, 0), wire(2, x, -5, x, 5)], [{ x, y: 0 }]],
			[[wire(1, -2 * x, 0, 2 * x, 0), wire(2, x, -5, x, 5)], []],
			[[wire(1, -1, x, 1, x), wire(2, 0, x - 512, 0, x + 512)], []],
			[
				[wire(1, -1, x, 1, x), wire(2, 0.5, x - 512, 0.5, x + 512)],
				[{ x: 0.5, y: x }],
			],
		] as const) {
			assert.deepEqual(
				[...buildWireCrossings([...shapes], [...junctions])],
				[...referenceWireCrossings([...shapes], [...junctions])],
				`2^${power}`,
			);
		}
	}
	const far = wire(1, 0, 1e18 - 512, 0, 1e18 + 512);
	assert.deepEqual(
		[...buildWireCrossings([far, wire(2, -1, 1e18, 1, 1e18)], [])],
		[...referenceWireCrossings([far, wire(2, -1, 1e18, 1, 1e18)], [])],
	);
});

test("symbol terminals are shared, frozen, and follow a moved symbol", () => {
	const resistor = symbolDefinitions.find(({ id }) => id === "resistor")!;
	const symbol = createSymbol(1, resistor, { x: 0, y: 0 });
	const terminals = pinTerminals(symbol);
	assert.equal(pinTerminals(symbol), terminals);
	assert.ok(Object.isFrozen(terminals) && terminals.every(Object.isFrozen));
	assert.deepEqual(
		pinTerminals({ ...symbol, x: 5 }),
		terminals.map(({ x, y }) => ({ x: x + 5, y })),
	);
	assert.deepEqual(
		terminals,
		symbolShapes(symbol)
			.filter((child) => child.kind === "pin")
			.map(({ x, y }) => ({ x, y })),
	);
});
