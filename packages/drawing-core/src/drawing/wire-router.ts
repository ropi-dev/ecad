import { connectionTolerance } from "#/drawing/connection-geometry.ts";
import type { Point } from "#/drawing/types.ts";

/** Axis directions in world coordinates: +x, +y, -x, -y. */
export type Heading = 0 | 1 | 2 | 3;

const stepX = [1, 0, -1, 0] as const;
const stepY = [0, 1, 0, -1] as const;
const opposite = (heading: number) => (heading + 2) % 4;

export function headingOf(angle: number): Heading | undefined {
	const x = Math.cos(angle);
	const y = Math.sin(angle);
	if (x > 0.99) return 0;
	if (y > 0.99) return 1;
	if (x < -0.99) return 2;
	if (y < -0.99) return 3;
	return undefined;
}

export const reverseHeading = (heading: Heading | undefined) =>
	heading === undefined ? undefined : (opposite(heading) as Heading);

/** Electrical net of a routed wire. Leads always block, and never share a net. */
export const LEAD_NET = -1;

export interface RouteWire {
	readonly start: Point;
	readonly end: Point;
	readonly net: number;
}

export interface RouteBody {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export interface RouteObstacles {
	/** Symbol bodies. Routes may run along an edge but never through the interior. */
	readonly bodies: readonly RouteBody[];
	/** Pin terminals and label anchors. Only the route's own ends may touch one. */
	readonly points: readonly Point[];
	/** Wires and pin leads, tagged with their net. */
	readonly wires: readonly RouteWire[];
}

type Entry<T> = { item: T; stamp: number };

class SpatialHash<T> {
	private readonly cells = new Map<number, Map<number, Entry<T>[]>>();
	private stamp = 0;
	private readonly size: number;
	constructor(size: number) {
		this.size = size;
	}

	insert(bounds: RouteBody, item: T) {
		const entry = { item, stamp: 0 };
		const [x0, x1, y0, y1] = this.range(bounds);
		for (let x = x0; x <= x1; x++) {
			let column = this.cells.get(x);
			if (!column) {
				column = new Map();
				this.cells.set(x, column);
			}
			for (let y = y0; y <= y1; y++) {
				const entries = column.get(y);
				if (entries) entries.push(entry);
				else column.set(y, [entry]);
			}
		}
	}

	query(bounds: RouteBody, visit: (item: T) => boolean | undefined) {
		const stamp = ++this.stamp;
		const [x0, x1, y0, y1] = this.range(bounds);
		for (let x = x0; x <= x1; x++) {
			const column = this.cells.get(x);
			if (!column) continue;
			for (let y = y0; y <= y1; y++) {
				for (const entry of column.get(y) ?? []) {
					if (entry.stamp === stamp) continue;
					entry.stamp = stamp;
					if (visit(entry.item)) return true;
				}
			}
		}
		return false;
	}

	private range(bounds: RouteBody) {
		const pad = connectionTolerance * 2;
		return [
			Math.floor((bounds.minX - pad) / this.size),
			Math.floor((bounds.maxX + pad) / this.size),
			Math.floor((bounds.minY - pad) / this.size),
			Math.floor((bounds.maxY + pad) / this.size),
		] as const;
	}
}

/** Spatial lookup of route obstacles. Build once per gesture and reuse it. */
export interface RoutingIndex {
	readonly bodies: SpatialHash<RouteBody>;
	readonly points: SpatialHash<Point>;
	readonly wires: SpatialHash<RouteWire>;
}

const segmentBounds = (start: Point, end: Point): RouteBody => ({
	minX: Math.min(start.x, end.x),
	minY: Math.min(start.y, end.y),
	maxX: Math.max(start.x, end.x),
	maxY: Math.max(start.y, end.y),
});

export function createRoutingIndex(
	obstacles: RouteObstacles,
	cell = 10,
): RoutingIndex {
	const index = {
		bodies: new SpatialHash<RouteBody>(cell),
		points: new SpatialHash<Point>(cell),
		wires: new SpatialHash<RouteWire>(cell),
	};
	for (const body of obstacles.bodies) index.bodies.insert(body, body);
	for (const point of obstacles.points)
		index.points.insert(segmentBounds(point, point), point);
	for (const wire of obstacles.wires)
		if (!samePoint(wire.start, wire.end) || wire.net === LEAD_NET)
			index.wires.insert(segmentBounds(wire.start, wire.end), wire);
	return index;
}

/** Adds wires to an existing index, such as routes placed earlier in one gesture. */
export function addRouteWires(
	index: RoutingIndex,
	wires: readonly RouteWire[],
) {
	for (const wire of wires)
		if (!samePoint(wire.start, wire.end))
			index.wires.insert(segmentBounds(wire.start, wire.end), wire);
}

/** Whether a point lies inside a symbol body, where no route can reach it. */
export function insideBody(
	indexes: readonly RoutingIndex[],
	point: Point,
): boolean {
	const bounds = segmentBounds(point, point);
	return indexes.some((index) =>
		index.bodies.query(
			bounds,
			(body) =>
				point.x > body.minX + BODY_INSET &&
				point.x < body.maxX - BODY_INSET &&
				point.y > body.minY + BODY_INSET &&
				point.y < body.maxY - BODY_INSET,
		),
	);
}

export interface RouteStart {
	readonly point: Point;
	/** Direction of the first step. Strict ends must leave this way. */
	readonly heading?: Heading;
	readonly strict?: boolean;
}

export interface RouteGoal {
	readonly point: Point;
	/** Required direction of the last step, for pins entered from outside. */
	readonly arrive?: Heading;
}

export interface RouteOptions {
	/** Lattice pitch. Routes bend on multiples of it or on the exact end coordinates. */
	readonly pitch: number;
	/** Nets the route belongs to. Wires of these nets may be touched and joined. */
	readonly nets: ReadonlySet<number>;
	/** Previous geometry of a rerouted trace. Reusing it is cheaper, which keeps nudges stable. */
	readonly memory?: readonly (readonly [Point, Point])[];
	readonly ignoreBodies?: boolean;
	readonly maxExpansions?: number;
	/** Expansions left for a whole gesture step; each search spends from it. */
	readonly budget?: { remaining: number };
}

const BEND = 3;
const CROSSING = 4;
const OVERLAP = 0.1;
const MEMORY = 0.6;
const BODY_INSET = 0.25;

const samePoint = (a: Point, b: Point) =>
	Math.abs(a.x - b.x) <= connectionTolerance &&
	Math.abs(a.y - b.y) <= connectionTolerance;

function lattice(
	from: number,
	to: number,
	pad: number,
	pitch: number,
): number[] {
	const min = Math.min(from, to) - pad;
	const max = Math.max(from, to) + pad;
	// Endpoints are often off the pitch grid, so give each a line one pitch away.
	const values = [from, to, from - pitch, from + pitch, to - pitch, to + pitch];
	for (let k = Math.ceil(min / pitch); k * pitch <= max; k++) {
		const value = k * pitch;
		values.push(value);
	}
	values.sort((a, b) => a - b);
	// Drop values next to an endpoint or an earlier value, keeping endpoints exact.
	const kept: number[] = [];
	for (const value of values) {
		const exact = value === from || value === to;
		const previous = kept.at(-1);
		if (previous !== undefined && value - previous <= pitch / 4) {
			if (!exact) continue;
			if (previous !== from && previous !== to) kept.pop();
			else if (value - previous <= connectionTolerance) continue;
		}
		kept.push(value);
	}
	return kept;
}

class Heap {
	private keys: number[] = [];
	private values: number[] = [];
	private order: number[] = [];
	private sequence = 0;
	get size() {
		return this.values.length;
	}
	push(value: number, key: number) {
		let index = this.values.length;
		this.values.push(value);
		this.keys.push(key);
		this.order.push(this.sequence++);
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (!this.before(index, parent)) break;
			this.swap(index, parent);
			index = parent;
		}
	}
	pop(): number {
		const top = this.values[0];
		const last = this.values.length - 1;
		this.swap(0, last);
		this.values.pop();
		this.keys.pop();
		this.order.pop();
		let index = 0;
		for (;;) {
			const left = index * 2 + 1;
			const right = left + 1;
			let best = index;
			if (left < this.values.length && this.before(left, best)) best = left;
			if (right < this.values.length && this.before(right, best)) best = right;
			if (best === index) break;
			this.swap(index, best);
			index = best;
		}
		return top;
	}
	private before(a: number, b: number) {
		return this.keys[a] !== this.keys[b]
			? this.keys[a] < this.keys[b]
			: this.order[a] < this.order[b];
	}
	private swap(a: number, b: number) {
		for (const array of [this.keys, this.values, this.order]) {
			const value = array[a];
			array[a] = array[b];
			array[b] = value;
		}
	}
}

interface EdgeResult {
	cost: number;
	/** The edge ends on a foreign wire's interior, so the route must continue straight. */
	straight: boolean;
}

function edgeCost(
	indexes: readonly RoutingIndex[],
	a: Point,
	b: Point,
	from: Point,
	to: Point,
	options: RouteOptions,
	pitch: number,
	strictEnds = false,
): EdgeResult | undefined {
	const horizontal = Math.abs(b.y - a.y) <= connectionTolerance;
	const bounds = segmentBounds(a, b);
	const length = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
	const lo = horizontal ? bounds.minX : bounds.minY;
	const hi = horizontal ? bounds.maxX : bounds.maxY;
	const across = horizontal ? a.y : a.x;
	const allowed = (point: Point) =>
		samePoint(point, from) || samePoint(point, to);
	const onEdge = (point: Point) =>
		Math.abs((horizontal ? point.y : point.x) - across) <=
			connectionTolerance &&
		(horizontal ? point.x : point.y) >= lo - connectionTolerance &&
		(horizontal ? point.x : point.y) <= hi + connectionTolerance;
	let cost = length;
	let straight = false;
	for (const index of indexes) {
		if (
			!options.ignoreBodies &&
			index.bodies.query(bounds, (body) =>
				horizontal
					? across > body.minY + BODY_INSET &&
						across < body.maxY - BODY_INSET &&
						hi > body.minX + BODY_INSET &&
						lo < body.maxX - BODY_INSET
					: across > body.minX + BODY_INSET &&
						across < body.maxX - BODY_INSET &&
						hi > body.minY + BODY_INSET &&
						lo < body.maxY - BODY_INSET,
			)
		)
			return undefined;
		if (index.points.query(bounds, (point) => onEdge(point) && !allowed(point)))
			return undefined;
		let blocked = false;
		const block = () => {
			blocked = true;
			return true;
		};
		index.wires.query(bounds, (wire) => {
			const own = options.nets.has(wire.net);
			const wireHorizontal =
				Math.abs(wire.end.y - wire.start.y) <=
				Math.abs(wire.end.x - wire.start.x);
			if (wireHorizontal === horizontal) {
				const wireAcross = horizontal ? wire.start.y : wire.start.x;
				if (Math.abs(wireAcross - across) > connectionTolerance) return false;
				const wireLo = horizontal
					? Math.min(wire.start.x, wire.end.x)
					: Math.min(wire.start.y, wire.end.y);
				const wireHi = horizontal
					? Math.max(wire.start.x, wire.end.x)
					: Math.max(wire.start.y, wire.end.y);
				const overlap = Math.min(hi, wireHi) - Math.max(lo, wireLo);
				if (overlap < -connectionTolerance) return false;
				if (own) {
					if (overlap > connectionTolerance) cost += overlap * OVERLAP;
					return false;
				}
				// Touching a foreign wire end-to-end, or running along it, joins the nets.
				if (overlap > connectionTolerance) return block();
				const touch = Math.abs(lo - wireHi) <= connectionTolerance ? lo : hi;
				const point = horizontal
					? { x: touch, y: across }
					: { x: across, y: touch };
				if (wire.net === LEAD_NET && allowed(point)) return false;
				return block();
			}
			// Perpendicular wire: find where it meets this edge's line.
			const at = horizontal ? wire.start.x : wire.start.y;
			const wireLo = horizontal
				? Math.min(wire.start.y, wire.end.y)
				: Math.min(wire.start.x, wire.end.x);
			const wireHi = horizontal
				? Math.max(wire.start.y, wire.end.y)
				: Math.max(wire.start.x, wire.end.x);
			if (
				at < lo - connectionTolerance ||
				at > hi + connectionTolerance ||
				across < wireLo - connectionTolerance ||
				across > wireHi + connectionTolerance
			)
				return false;
			const point = horizontal ? { x: at, y: across } : { x: across, y: at };
			if (wire.net === LEAD_NET) {
				if (allowed(point)) return false;
				return block();
			}
			if (own) return false;
			const atWireEnd =
				Math.abs(across - wireLo) <= connectionTolerance ||
				Math.abs(across - wireHi) <= connectionTolerance;
			if (atWireEnd) return block();
			const atStart =
				Math.abs(at - (horizontal ? a.x : a.y)) <= connectionTolerance;
			// An existing segment must not end on a foreign wire, which would join it.
			if (
				strictEnds &&
				(atStart ||
					Math.abs(at - (horizontal ? b.x : b.y)) <= connectionTolerance)
			)
				return block();
			// The crossing at the edge's start was charged when entering that node.
			if (atStart) return false;
			if (Math.abs(at - (horizontal ? b.x : b.y)) <= connectionTolerance) {
				if (allowed(b)) return block();
				straight = true;
			}
			cost += CROSSING * pitch;
			return false;
		});
		if (blocked) return undefined;
	}
	if (options.memory?.length) {
		let reused = 0;
		for (const [start, end] of options.memory) {
			const memoryHorizontal =
				Math.abs(end.y - start.y) <= Math.abs(end.x - start.x);
			if (memoryHorizontal !== horizontal) continue;
			if (
				Math.abs((horizontal ? start.y : start.x) - across) >
				connectionTolerance
			)
				continue;
			const memoryLo = horizontal
				? Math.min(start.x, end.x)
				: Math.min(start.y, end.y);
			const memoryHi = horizontal
				? Math.max(start.x, end.x)
				: Math.max(start.y, end.y);
			reused += Math.max(0, Math.min(hi, memoryHi) - Math.max(lo, memoryLo));
		}
		cost -= Math.min(length, reused) * (1 - MEMORY);
	}
	return { cost, straight };
}

/**
 * Whether an existing orthogonal segment can stay where it is: it touches no
 * foreign pin or wire and crosses no symbol body. Only `allowed` may touch a pin.
 */
export function segmentClear(
	indexes: readonly RoutingIndex[],
	start: Point,
	end: Point,
	nets: ReadonlySet<number>,
	allowed: readonly Point[],
): boolean {
	if (samePoint(start, end)) return true;
	if (
		Math.abs(start.x - end.x) > connectionTolerance &&
		Math.abs(start.y - end.y) > connectionTolerance
	)
		return false;
	const [first = start, second = first] = allowed;
	return !!edgeCost(
		indexes,
		start,
		end,
		first,
		second,
		{ pitch: 1, nets },
		1,
		true,
	);
}

function bendsNeeded(dx: number, dy: number, heading: number): number {
	const tolerance = connectionTolerance;
	if (Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance) return 0;
	const wanted: number[] = [];
	if (dx > tolerance) wanted.push(0);
	if (dy > tolerance) wanted.push(1);
	if (dx < -tolerance) wanted.push(2);
	if (dy < -tolerance) wanted.push(3);
	if (heading < 0) return wanted.length - 1;
	if (wanted.length === 1)
		return wanted[0] === heading ? 0 : wanted[0] === opposite(heading) ? 2 : 1;
	return wanted.includes(heading) ? 1 : 2;
}

/**
 * Orthogonal A* over a sparse lattice of pitch multiples plus the exact end
 * coordinates. States carry a heading so bends cost extra and pins are left
 * and entered along their leads. Returns the corner points, or undefined.
 */
export function routeOrthogonal(
	indexes: readonly RoutingIndex[],
	from: RouteStart,
	to: RouteGoal,
	options: RouteOptions,
): Point[] | undefined {
	if (samePoint(from.point, to.point)) return [from.point, to.point];
	const pitch = options.pitch > 0 ? options.pitch : 1.27;
	// A walled-in end makes every search fail after its whole budget; check first.
	const probe = (point: Point, heading: number, leaving: boolean) => {
		const near = {
			x: point.x + (stepX[heading] * pitch) / 2,
			y: point.y + (stepY[heading] * pitch) / 2,
		};
		return !!edgeCost(
			indexes,
			leaving ? point : near,
			leaving ? near : point,
			from.point,
			to.point,
			options,
			pitch,
		);
	};
	const exits =
		from.heading !== undefined && from.strict ? [from.heading] : [0, 1, 2, 3];
	const entries = to.arrive === undefined ? [0, 1, 2, 3] : [to.arrive];
	if (
		!exits.some((heading) => probe(from.point, heading, true)) ||
		!entries.some((heading) => probe(to.point, opposite(heading), false))
	)
		return undefined;
	const shared = options.budget;
	let budget = Math.min(
		options.maxExpansions ?? 40_000,
		shared?.remaining ?? Number.POSITIVE_INFINITY,
	);
	for (const steps of [8, 24, 64]) {
		if (budget <= 0) return undefined;
		const result = search(
			indexes,
			from,
			to,
			options,
			pitch,
			steps * pitch,
			budget,
		);
		budget -= result.expanded;
		if (shared) shared.remaining -= result.expanded;
		if (result.points) return result.points;
	}
	return undefined;
}

function search(
	indexes: readonly RoutingIndex[],
	from: RouteStart,
	to: RouteGoal,
	options: RouteOptions,
	pitch: number,
	pad: number,
	budget: number,
): { points?: Point[]; expanded: number } {
	const xs = lattice(from.point.x, to.point.x, pad, pitch);
	const ys = lattice(from.point.y, to.point.y, pad, pitch);
	const width = xs.length;
	const count = width * ys.length * 4;
	const find = (values: number[], value: number) =>
		values.findIndex((item) => Math.abs(item - value) <= connectionTolerance);
	const startX = find(xs, from.point.x);
	const startY = find(ys, from.point.y);
	const goalX = find(xs, to.point.x);
	const goalY = find(ys, to.point.y);
	const scores = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
	const parents = new Int32Array(count).fill(-1);
	const straightOnly = new Uint8Array(count);
	const closed = new Uint8Array(count);
	const open = new Heap();
	const scale = options.memory?.length ? MEMORY : 1;
	const estimate = (x: number, y: number, heading: number) => {
		const dx = xs[goalX] - xs[x];
		const dy = ys[goalY] - ys[y];
		return (
			(Math.abs(dx) + Math.abs(dy)) * scale +
			bendsNeeded(dx, dy, heading) * BEND * pitch
		);
	};
	const state = (x: number, y: number, heading: number) =>
		((y * width + x) << 2) | heading;
	const startHeadings: [number, number][] =
		from.heading === undefined
			? [0, 1, 2, 3].map((heading) => [heading, 0])
			: from.strict
				? [[from.heading, 0]]
				: [0, 1, 2, 3]
						.filter((heading) => heading !== opposite(from.heading ?? 0))
						.map((heading) => [
							heading,
							heading === from.heading ? 0 : BEND * pitch,
						]);
	for (const [heading, cost] of startHeadings) {
		const id = state(startX, startY, heading);
		scores[id] = cost;
		open.push(id, cost + estimate(startX, startY, heading));
	}
	let expanded = 0;
	while (open.size) {
		const id = open.pop();
		if (closed[id]) continue;
		closed[id] = 1;
		const heading = id & 3;
		const node = id >> 2;
		const x = node % width;
		const y = (node - x) / width;
		const atStart = x === startX && y === startY;
		if (x === goalX && y === goalY) {
			if (to.arrive === undefined || to.arrive === heading)
				return { points: corners(id, parents, xs, ys, width), expanded };
			continue;
		}
		if (++expanded > budget) return { expanded };
		const point = { x: xs[x], y: ys[y] };
		for (let next = 0; next < 4; next++) {
			// Starting states already chose the first step's direction.
			if (atStart && next !== heading && parents[id] < 0) continue;
			if (next === opposite(heading) && !atStart) continue;
			if (straightOnly[id] && next !== heading) continue;
			const nx = x + stepX[next];
			const ny = y + stepY[next];
			if (nx < 0 || ny < 0 || nx >= width || ny >= ys.length) continue;
			const target = { x: xs[nx], y: ys[ny] };
			const edge = edgeCost(
				indexes,
				point,
				target,
				from.point,
				to.point,
				options,
				pitch,
			);
			if (!edge) continue;
			const nextId = state(nx, ny, next);
			if (closed[nextId]) continue;
			const score =
				scores[id] + edge.cost + (next === heading ? 0 : BEND * pitch);
			if (score >= scores[nextId] - 1e-9) continue;
			scores[nextId] = score;
			parents[nextId] = id;
			straightOnly[nextId] = edge.straight ? 1 : 0;
			open.push(nextId, score + estimate(nx, ny, next));
		}
	}
	return { expanded };
}

function corners(
	id: number,
	parents: Int32Array,
	xs: number[],
	ys: number[],
	width: number,
): Point[] {
	const path: Point[] = [];
	for (let current = id; current >= 0; current = parents[current]) {
		const node = current >> 2;
		const x = node % width;
		path.push({ x: xs[x], y: ys[(node - x) / width] });
	}
	path.reverse();
	return simplifyPath(path);
}

/** Drops repeated and collinear interior points. */
export function simplifyPath(path: readonly Point[]): Point[] {
	const points = path.filter(
		(point, index) => index === 0 || !samePoint(point, path[index - 1]),
	);
	return points.filter((point, index) => {
		if (index === 0 || index === points.length - 1) return true;
		const previous = points[index - 1];
		const next = points[index + 1];
		const vertical =
			Math.abs(previous.x - point.x) <= connectionTolerance &&
			Math.abs(next.x - point.x) <= connectionTolerance;
		const horizontal =
			Math.abs(previous.y - point.y) <= connectionTolerance &&
			Math.abs(next.y - point.y) <= connectionTolerance;
		return !vertical && !horizontal;
	});
}
