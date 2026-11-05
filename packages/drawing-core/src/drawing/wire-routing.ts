import {
	connectionTolerance,
	pointOnWire,
} from "#/drawing/connection-geometry.ts";
import { electricalNets } from "#/drawing/named-nets.ts";
import type { EditorShape, PrimitiveShape } from "#/drawing/schema.ts";
import {
	drawShape,
	localToWorld,
	shapeBounds,
} from "#/drawing/shape-geometry.ts";
import { symbolShapes } from "#/drawing/symbol-instances.ts";
import type { Point } from "#/drawing/types.ts";
import {
	createRoutingIndex,
	type Heading,
	headingOf,
	insideBody,
	LEAD_NET,
	type RouteBody,
	type RouteGoal,
	type RouteStart,
	type RouteWire,
	type RoutingIndex,
	reverseHeading,
	routeOrthogonal,
	segmentClear,
	simplifyPath,
} from "#/drawing/wire-router.ts";

/** Electrical net ids per shape, from `electricalNets`. Unknown items get their own net. */
export interface NetLookup {
	wire(id: number): number;
	pin(shapeId: number, pinId: number): number;
	label(id: number): number;
}

export function netLookup(shapes: readonly EditorShape[]): NetLookup {
	const wires = new Map<number, number>();
	const pins = new Map<string, number>();
	const labels = new Map<number, number>();
	for (const [
		net,
		{ wires: wireIds, pins: pinIds, labels: labelIds },
	] of electricalNets(shapes).entries()) {
		for (const id of wireIds) wires.set(id, net);
		for (const { shapeId, pinId } of pinIds)
			pins.set(`${shapeId}:${pinId}`, net);
		for (const id of labelIds) labels.set(id, net);
	}
	// Unknown items are isolated. Offsets keep them clear of real net indexes.
	const isolated = 1 << 28;
	return {
		wire: (id) => wires.get(id) ?? isolated + id * 2,
		pin: (shapeId, pinId) =>
			pins.get(`${shapeId}:${pinId}`) ?? isolated + shapeId * 2 + 1,
		label: (id) => labels.get(id) ?? isolated + id * 2,
	};
}

export interface PinEnd {
	readonly shape: EditorShape;
	readonly pinId: number;
	readonly point: Point;
	/** Direction from the terminal away from the body, when the pin has a lead. */
	readonly outward?: Heading;
	readonly lead?: readonly [Point, Point];
}

const pinEndCache = new WeakMap<EditorShape, PinEnd[]>();

/** Pin terminals of a symbol or standalone pin, in `pinTerminals` order. Component pins carry their lead. */
export function pinEnds(shape: EditorShape): PinEnd[] {
	if (shape.kind !== "pin" && shape.kind !== "symbol") return [];
	const cached = pinEndCache.get(shape);
	if (cached) return cached;
	const ends =
		shape.kind === "pin"
			? // Standalone pins are drawing primitives; only component pins steer routes.
				[{ shape, pinId: shape.id, point: { x: shape.x, y: shape.y } }]
			: symbolPinEnds(shape);
	pinEndCache.set(shape, ends);
	return ends;
}

function symbolPinEnds(shape: EditorShape & { kind: "symbol" }): PinEnd[] {
	const body = symbolBody(shape);
	return symbolShapes(shape).flatMap((pin): PinEnd[] => {
		if (pin.kind !== "pin") return [];
		const length = pin.length ?? 0;
		const point = { x: pin.x, y: pin.y };
		if (length > connectionTolerance)
			return [
				{
					shape,
					pinId: pin.id,
					point,
					outward: headingOf(pin.rotation + Math.PI),
					lead: [
						point,
						{
							x: pin.x + Math.cos(pin.rotation) * length,
							y: pin.y + Math.sin(pin.rotation) * length,
						},
					] as const,
				},
			];
		// Built-in symbols draw leads as lines, so the body edge gives the direction.
		return [{ shape, pinId: pin.id, point, outward: outwardFrom(body, point) }];
	});
}

function outwardFrom(
	body: RouteBody | undefined,
	point: Point,
): Heading | undefined {
	if (!body) return undefined;
	const tolerance = 0.01;
	if (point.x <= body.minX + tolerance) return 2;
	if (point.x >= body.maxX - tolerance) return 0;
	if (point.y <= body.minY + tolerance) return 3;
	if (point.y >= body.maxY - tolerance) return 1;
	const dx = point.x - (body.minX + body.maxX) / 2;
	const dy = point.y - (body.minY + body.maxY) / 2;
	if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
	return dy >= 0 ? 1 : 3;
}

export const wireEnds = (shape: EditorShape): [Point, Point] => [
	localToWorld(shape, -shape.width / 2, 0),
	localToWorld(shape, shape.width / 2, 0),
];

export const isElectricalLabel = (shape: EditorShape) =>
	shape.kind === "text" && !!shape.electrical && !!shape.text.trim();

function symbolBody(shape: EditorShape): RouteBody | undefined {
	if (shape.kind !== "symbol") return;
	let body: RouteBody | undefined;
	for (const child of symbolShapes(shape)) {
		if (child.kind === "pin" || child.kind === "text") continue;
		const bounds = shapeBounds(child);
		body = body
			? {
					minX: Math.min(body.minX, bounds.minX),
					minY: Math.min(body.minY, bounds.minY),
					maxX: Math.max(body.maxX, bounds.maxX),
					maxY: Math.max(body.maxY, bounds.maxY),
				}
			: bounds;
	}
	return body;
}

export interface MutableObstacles {
	bodies: RouteBody[];
	points: Point[];
	wires: RouteWire[];
}

export const emptyObstacles = (): MutableObstacles => ({
	bodies: [],
	points: [],
	wires: [],
});

/** Adds a shape's routing obstacles. Wires use `wireNet`, so callers can retag moved pieces. */
export function addShapeObstacles(
	into: MutableObstacles,
	shape: EditorShape,
	nets: NetLookup,
) {
	if (shape.kind === "wire") {
		if (shape.width <= connectionTolerance) return;
		const [start, end] = wireEnds(shape);
		into.wires.push({ start, end, net: nets.wire(shape.id) });
		return;
	}
	if (isElectricalLabel(shape)) {
		into.points.push({ x: shape.x, y: shape.y });
		return;
	}
	const body = symbolBody(shape);
	if (body) into.bodies.push(body);
	for (const end of pinEnds(shape)) {
		into.points.push(end.point);
		if (end.lead)
			into.wires.push({ start: end.lead[0], end: end.lead[1], net: LEAD_NET });
	}
}

export function routingIndexFor(
	shapes: readonly EditorShape[],
	nets: NetLookup,
): RoutingIndex {
	const obstacles = emptyObstacles();
	for (const shape of shapes) addShapeObstacles(obstacles, shape, nets);
	return createRoutingIndex(obstacles);
}

/** The connection at a point: a pin terminal, a label anchor, or a wire through it. */
export function connectionAt(
	shapes: readonly EditorShape[],
	nets: NetLookup,
	point: Point,
): { nets: number[]; pin?: PinEnd } {
	const found = new Set<number>();
	let pin: PinEnd | undefined;
	for (const shape of shapes) {
		if (shape.kind === "wire") {
			if (shape.width <= connectionTolerance) continue;
			const [start, end] = wireEnds(shape);
			if (pointOnWire(point, start, end)) found.add(nets.wire(shape.id));
		} else if (isElectricalLabel(shape)) {
			if (
				Math.hypot(shape.x - point.x, shape.y - point.y) <= connectionTolerance
			)
				found.add(nets.label(shape.id));
		} else if (shape.kind === "symbol" || shape.kind === "pin") {
			for (const end of pinEnds(shape))
				if (
					Math.hypot(end.point.x - point.x, end.point.y - point.y) <=
					connectionTolerance
				) {
					found.add(nets.pin(shape.id, end.pinId));
					pin ??= end;
				}
		}
	}
	return { nets: [...found], pin };
}

export interface RouteRequest {
	readonly from: RouteStart;
	readonly to: RouteGoal;
	readonly nets: ReadonlySet<number>;
	readonly pitch: number;
	readonly memory?: readonly (readonly [Point, Point])[];
	readonly budget?: { remaining: number };
}

/**
 * Routes around obstacles, then retries without pin directions and through
 * symbol bodies, then falls back to a plain L so a gesture always has a
 * result. `clear` reports whether the result touches no other net or pin.
 */
export function routePath(
	indexes: readonly RoutingIndex[],
	request: RouteRequest,
): { points: Point[]; routed: boolean; clear: boolean } {
	const options = {
		pitch: request.pitch,
		nets: request.nets,
		memory: request.memory,
		budget: request.budget,
	};
	const relaxedFrom = { ...request.from, strict: false };
	const relaxedTo = { point: request.to.point };
	// An end inside a body (a part dropped onto another) can only be reached
	// through bodies, so skip the searches that cannot succeed.
	const enclosed =
		insideBody(indexes, request.from.point) ||
		insideBody(indexes, request.to.point);
	// Pin directions and bodies are preferences; touching another net never is.
	const routed =
		(enclosed
			? undefined
			: (routeOrthogonal(indexes, request.from, request.to, options) ??
				routeOrthogonal(indexes, relaxedFrom, relaxedTo, {
					...options,
					maxExpansions: 20_000,
				}))) ??
		routeOrthogonal(indexes, relaxedFrom, relaxedTo, {
			...options,
			ignoreBodies: true,
			maxExpansions: 10_000,
		});
	if (routed) {
		routed[0] = request.from.point;
		routed[routed.length - 1] = request.to.point;
		return { points: routed, routed: true, clear: true };
	}
	return fallbackPath(indexes, request);
}

/** A plain L between the ends, preferring an orientation that touches nothing foreign. */
export function fallbackPath(
	indexes: readonly RoutingIndex[],
	request: Pick<RouteRequest, "from" | "to" | "nets">,
): { points: Point[]; routed: false; clear: boolean } {
	const { point: start } = request.from;
	const { point: end } = request.to;
	const preferHorizontal =
		request.from.heading === undefined
			? Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
			: request.from.heading % 2 === 0;
	// Prefer whichever L touches no other net or pin.
	const candidates = [preferHorizontal, !preferHorizontal].map((horizontal) => {
		const points = simplifyPath([
			start,
			horizontal ? { x: end.x, y: start.y } : { x: start.x, y: end.y },
			end,
		]);
		const clear = points
			.slice(1)
			.every((point, index) =>
				segmentClear(indexes, points[index], point, request.nets, [start, end]),
			);
		return { points, routed: false as const, clear };
	});
	return candidates.find(({ clear }) => clear) ?? candidates[0];
}

/** Wire segments along a corner path, numbered from `id`. */
export function pathWires(
	id: number,
	points: readonly Point[],
	lineWidth?: number,
): PrimitiveShape[] {
	const wires: PrimitiveShape[] = [];
	for (let index = 1; index < points.length; index++) {
		const wire = drawShape(
			id + wires.length,
			"wire",
			points[index - 1],
			points[index],
		);
		if (wire.width <= connectionTolerance) continue;
		wires.push(lineWidth === undefined ? wire : { ...wire, lineWidth });
	}
	return wires;
}

/** The heading a path leaves its last point with. */
export function finalHeading(points: readonly Point[]): Heading | undefined {
	if (points.length < 2) return undefined;
	const end = points[points.length - 1];
	const previous = points[points.length - 2];
	return headingOf(Math.atan2(end.y - previous.y, end.x - previous.x));
}

/** Routing pitch for a snap grid: its step, kept between 50 and 100 mil. */
export const routingPitch = (gridStep: number) =>
	gridStep > 0 ? Math.min(Math.max(gridStep, 1.27), 2.54) : 1.27;

/** Obstacles and nets of a drawing, built once while the drawing is unchanged. */
export interface WireRoutingContext {
	readonly shapes: readonly EditorShape[];
	readonly nets: NetLookup;
	readonly index: RoutingIndex;
}

export function createWireRoutingContext(
	shapes: readonly EditorShape[],
): WireRoutingContext {
	const nets = netLookup(shapes);
	return { shapes, nets, index: routingIndexFor(shapes, nets) };
}

/**
 * Routes a new wire from `start` to the connection at `end`. A wire leaving a
 * pin starts along its lead when `fromPin` is set; otherwise `heading` is the
 * preferred first direction. A pin at `end` is entered from outside.
 */
export function routeWireConnection(
	context: WireRoutingContext,
	start: Point,
	end: Point,
	{
		pitch,
		heading,
		fromPin = false,
	}: { pitch: number; heading?: Heading; fromPin?: boolean },
): { points: Point[]; clear: boolean } {
	const origin = connectionAt(context.shapes, context.nets, start);
	const target = connectionAt(context.shapes, context.nets, end);
	const exit = fromPin ? origin.pin?.outward : undefined;
	return routePath([context.index], {
		from:
			exit === undefined
				? { point: start, heading }
				: { point: start, heading: exit, strict: true },
		to: { point: end, arrive: reverseHeading(target.pin?.outward) },
		nets: new Set([...origin.nets, ...target.nets]),
		pitch,
	});
}
