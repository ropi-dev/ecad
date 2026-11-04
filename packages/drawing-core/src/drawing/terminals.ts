import {
	connectionTolerance,
	createPointIndex,
	createWireIndex,
	pointOnWire,
} from "#/drawing/connection-geometry.ts";
import type { EditorShape, PrimitiveShape } from "#/drawing/schema.ts";
import { drawShape, localToWorld } from "#/drawing/shape-geometry.ts";
import { symbolShapes } from "#/drawing/symbol-instances.ts";
import type { Point } from "#/drawing/types.ts";

const symbolTerminals = new WeakMap<EditorShape, readonly Point[]>();

export function pinTerminals(shape: EditorShape): readonly Point[] {
	if (shape.kind === "pin") return [{ x: shape.x, y: shape.y }];
	if (shape.kind !== "symbol") return [];
	let terminals = symbolTerminals.get(shape);
	if (!terminals) {
		terminals = Object.freeze(
			symbolShapes(shape)
				.flatMap(pinTerminals)
				.map((point) => Object.freeze(point)),
		);
		symbolTerminals.set(shape, terminals);
	}
	return terminals;
}

export function openPins(
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
	const onWire = createWireIndex(
		shapes
			.filter((shape) => shape.kind === "wire")
			.map((shape) => ({
				start: localToWorld(shape, -shape.width / 2, 0),
				end: localToWorld(shape, shape.width / 2, 0),
			})),
	);
	const nearNoConnect = createPointIndex(
		shapes.flatMap((shape) =>
			shape.kind === "symbol"
				? symbolShapes(shape).filter((child) => child.kind === "no-connect")
				: shape.kind === "no-connect"
					? [shape]
					: [],
		),
		(shape) => shape,
	);
	const nearPin = createPointIndex(pins, ({ point }) => point);
	return candidates.filter(
		(pin) =>
			!nearNoConnect(
				pin.point,
				(shape) =>
					Math.hypot(shape.x - pin.point.x, shape.y - pin.point.y) <=
					connectionTolerance,
			) &&
			!onWire(pin.point, ({ start, end }) =>
				pointOnWire(pin.point, start, end),
			) &&
			!nearPin(
				pin.point,
				(other) =>
					other !== pin &&
					Math.hypot(
						other.point.x - pin.point.x,
						other.point.y - pin.point.y,
					) <= connectionTolerance,
			),
	);
}

export function netLabelAnchors(shapes: EditorShape[]): Point[] {
	return shapes
		.filter(
			(shape) => shape.kind === "text" && shape.electrical && shape.text.trim(),
		)
		.map((shape) => ({ x: shape.x, y: shape.y }));
}

export function openWireEnds(shapes: EditorShape[]) {
	const nearPin = createPointIndex(
		[...shapes.flatMap(pinTerminals), ...netLabelAnchors(shapes)],
		(pin) => pin,
	);
	const wires = shapes
		.filter((shape) => shape.kind === "wire")
		.map((shape) => ({
			shape,
			start: localToWorld(shape, -shape.width / 2, 0),
			end: localToWorld(shape, shape.width / 2, 0),
		}));
	const onWire = createWireIndex(wires);
	return wires.flatMap((wire) =>
		[wire.start, wire.end]
			.filter(
				(point) =>
					!nearPin(
						point,
						(pin) =>
							Math.hypot(pin.x - point.x, pin.y - point.y) <=
							connectionTolerance,
					) &&
					!onWire(
						point,
						(other) =>
							other !== wire && pointOnWire(point, other.start, other.end),
					),
			)
			.map((point) => ({ shape: wire.shape, point })),
	);
}

export function wireConnectionPoints(shapes: EditorShape[]): Point[] {
	return [
		...shapes.flatMap(pinTerminals),
		...netLabelAnchors(shapes),
		...openWireEnds(shapes).map(({ point }) => point),
	];
}

export function wireJunctions(shapes: EditorShape[]) {
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
	type Candidate = { point: Point; pins: EditorShape[] };
	const candidates = new Map<number, Map<number, Candidate[]>>();
	// Buckets in creation order, so results keep a stable document-derived order.
	const buckets: Candidate[][] = [];
	const atPoint = (point: Point) => {
		const x = bucket(point.x);
		const y = bucket(point.y);
		for (let dx = -1; dx <= 1; dx++) {
			const column = candidates.get(x + dx);
			if (!column) continue;
			for (let dy = -1; dy <= 1; dy++) {
				const existing = column
					.get(y + dy)
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
		let column = candidates.get(x);
		if (!column) {
			column = new Map();
			candidates.set(x, column);
		}
		let entries = column.get(y);
		if (!entries) {
			entries = [];
			column.set(y, entries);
			buckets.push(entries);
		}
		entries.push(candidate);
		return candidate;
	};
	for (const shape of shapes) {
		for (const point of pinTerminals(shape)) atPoint(point).pins.push(shape);
	}
	for (const { start, end } of wires) {
		atPoint(start);
		atPoint(end);
	}
	return buckets.flat().flatMap(({ point, pins }) => {
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

export function findWireConnection(
	shapes: EditorShape[],
	point: Point,
	tolerance: number,
	start?: Point,
): Point | undefined {
	let nearest: Point | undefined;
	let distance = tolerance;
	const wires = shapes
		.filter(
			(shape) => shape.kind === "wire" && shape.width > connectionTolerance,
		)
		.map((shape) => ({
			shape,
			start: localToWorld(shape, -shape.width / 2, 0),
			end: localToWorld(shape, shape.width / 2, 0),
		}));
	const consider = (candidate: Point) => {
		if (
			start &&
			Math.hypot(candidate.x - start.x, candidate.y - start.y) <=
				connectionTolerance
		)
			return;
		const next = Math.hypot(candidate.x - point.x, candidate.y - point.y);
		if (next <= distance) {
			nearest = candidate;
			distance = next;
		}
	};
	// Prefer exact terminals and existing junctions before projecting onto a segment.
	for (const candidate of [
		...shapes.flatMap(pinTerminals),
		...netLabelAnchors(shapes),
		...wires.flatMap(({ start, end }) => [start, end]),
	])
		consider(candidate);
	if (nearest) return nearest;
	for (const wire of wires) {
		const vertical =
			Math.abs(wire.end.x - wire.start.x) < Math.abs(wire.end.y - wire.start.y);
		const along = vertical ? "y" : "x";
		const across = vertical ? "x" : "y";
		const candidate = { ...point, [across]: wire.shape[across] };
		candidate[along] = Math.max(
			Math.min(wire.start[along], wire.end[along]),
			Math.min(candidate[along], Math.max(wire.start[along], wire.end[along])),
		);
		consider(candidate);
	}
	return nearest;
}

export function routeWire(
	id: number,
	start: Point,
	end: Point,
	horizontalFirst = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y),
): PrimitiveShape[] {
	if (
		Math.abs(end.x - start.x) <= connectionTolerance ||
		Math.abs(end.y - start.y) <= connectionTolerance
	)
		return [drawShape(id, "wire", start, end)];
	const corner = horizontalFirst
		? { x: end.x, y: start.y }
		: { x: start.x, y: end.y };
	return [
		drawShape(id, "wire", start, corner),
		drawShape(id + 1, "wire", corner, end),
	];
}
