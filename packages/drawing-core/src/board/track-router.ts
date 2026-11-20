import type { CopperItem, CopperLayer } from "#/board/connectivity.ts";
import {
	type Hull,
	hullDistance,
	pointHullDistance,
} from "#/board/geometry.ts";
import type { Bounds, Point } from "#/drawing/types.ts";

export type TrackPosture = "straight-first" | "diagonal-first";

/**
 * The corner points of a track from `start` to `end` using horizontal,
 * vertical and 45 degree segments: one straight run and one diagonal.
 */
export function trackPath(
	start: Point,
	end: Point,
	posture: TrackPosture = "straight-first",
): Point[] {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const ax = Math.abs(dx);
	const ay = Math.abs(dy);
	if (ax < 1e-9 || ay < 1e-9 || Math.abs(ax - ay) < 1e-9) return [start, end];
	const diagonal = Math.min(ax, ay);
	const straight =
		ax > ay
			? { x: Math.sign(dx) * (ax - diagonal), y: 0 }
			: { x: 0, y: Math.sign(dy) * (ay - diagonal) };
	const corner =
		posture === "straight-first"
			? { x: start.x + straight.x, y: start.y + straight.y }
			: { x: end.x - straight.x, y: end.y - straight.y };
	return [start, corner, end];
}

const directions = [
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
	[0, -1],
	[1, -1],
] as const;

export function octant(vector: Point): number {
	const turn = Math.round(Math.atan2(vector.y, vector.x) / (Math.PI / 4));
	return (turn + 8) % 8;
}

export function octantDelta(delta: Point, gridStep: number): Point {
	const length = Math.hypot(delta.x, delta.y);
	if (length < 1e-12) return { x: 0, y: 0 };
	const [dx, dy] = directions[octant(delta)];
	const along = (delta.x * dx + delta.y * dy) / Math.hypot(dx, dy);
	let step = along / Math.hypot(dx, dy);
	if (gridStep > 0) step = Math.round(step / gridStep) * gridStep;
	return { x: dx * step || 0, y: dy * step || 0 };
}

export interface TrackRouting {
	readonly items: readonly CopperItem[];
	readonly clearance: number;
}

export interface TrackRoute {
	readonly from: Point;
	readonly to: Point;
	readonly layer: string;
	readonly width: number;
	readonly net?: string;
	readonly prefer?: Point;
	readonly ignore: ReadonlySet<number>;
}

export interface RouteBudget {
	remaining: number;
}

interface Obstacle {
	readonly hull: Hull;
	readonly gap: number;
	readonly bounds: Bounds;
}

const pitch = 0.1;
const margin = pitch * 0.25;
const bucket = 2;
const bend = pitch * 3;
const windows = [1, 3, 8];
const searchLimit = 12_000;

const bucketKey = (x: number, y: number) => (x + 32_768) * 65_536 + y + 32_768;

function forBuckets(
	bounds: Bounds,
	visit: (key: number) => void,
	size = bucket,
) {
	for (
		let x = Math.floor(bounds.minX / size);
		x <= Math.floor(bounds.maxX / size);
		x++
	)
		for (
			let y = Math.floor(bounds.minY / size);
			y <= Math.floor(bounds.maxY / size);
			y++
		)
			visit(bucketKey(x, y));
}

const itemIndexes = new WeakMap<
	readonly CopperItem[],
	Map<number, CopperItem[]>
>();

function itemIndex(items: readonly CopperItem[]) {
	let index = itemIndexes.get(items);
	if (index) return index;
	index = new Map();
	for (const item of items) {
		if (item.kind === "zone" || item.kind === "hole") continue;
		forBuckets(item.bounds, (key) => {
			const list = index?.get(key);
			if (list) list.push(item);
			else index?.set(key, [item]);
		});
	}
	itemIndexes.set(items, index);
	return index;
}

function obstaclesFor(
	route: TrackRoute,
	routing: TrackRouting,
	area: Bounds,
): Obstacle[] {
	const half = route.width / 2;
	const reach = half + routing.clearance;
	const index = itemIndex(routing.items);
	const seen = new Set<CopperItem>();
	const obstacles: Obstacle[] = [];
	forBuckets(
		{
			minX: area.minX - reach,
			minY: area.minY - reach,
			maxX: area.maxX + reach,
			maxY: area.maxY + reach,
		},
		(key) => {
			for (const item of index.get(key) ?? []) {
				if (seen.has(item)) continue;
				seen.add(item);
				if (route.ignore.has(item.shapeId)) continue;
				if (!item.layers.includes(route.layer as CopperLayer)) continue;
				if (
					route.net === undefined ||
					item.net === undefined ||
					item.net === route.net
				)
					continue;
				for (const hull of item.hulls) {
					const gap = Math.min(
						routing.clearance,
						pointHullDistance(hull, route.from) - half,
					);
					const grow = Math.max(0, half + gap + margin);
					const { bounds } = item;
					obstacles.push({
						hull,
						gap,
						bounds: {
							minX: bounds.minX - grow,
							minY: bounds.minY - grow,
							maxX: bounds.maxX + grow,
							maxY: bounds.maxY + grow,
						},
					});
				}
			}
		},
	);
	return obstacles;
}

function pathClear(
	path: readonly Point[],
	obstacles: readonly Obstacle[],
	width: number,
) {
	for (let index = 1; index < path.length; index++) {
		const segment = {
			points: [path[index - 1], path[index]],
			radius: width / 2,
		};
		for (const { hull, gap } of obstacles)
			if (hullDistance(segment, hull) < gap - 1e-9) return false;
	}
	return true;
}

const samePoint = (a: Point, b: Point) =>
	Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

function simplify(path: readonly Point[]): Point[] {
	const points: Point[] = [];
	for (const point of path) {
		const previous = points.at(-1);
		if (previous && samePoint(previous, point)) continue;
		const before = points.at(-2);
		if (before && previous) {
			const ux = previous.x - before.x;
			const uy = previous.y - before.y;
			const vx = point.x - previous.x;
			const vy = point.y - previous.y;
			if (
				Math.abs(ux * vy - uy * vx) <=
				1e-6 * Math.hypot(ux, uy) * Math.hypot(vx, vy)
			) {
				points.pop();
				if (!samePoint(before, point)) points.push(point);
				continue;
			}
		}
		points.push(point);
	}
	return points;
}

const spanOf = (points: readonly Point[], pad: number): Bounds => ({
	minX: Math.min(...points.map((point) => point.x)) - pad,
	minY: Math.min(...points.map((point) => point.y)) - pad,
	maxX: Math.max(...points.map((point) => point.x)) + pad,
	maxY: Math.max(...points.map((point) => point.y)) + pad,
});

export function trackClear(
	route: TrackRoute,
	path: readonly Point[],
	routing: TrackRouting | undefined,
) {
	if (!routing) return true;
	return pathClear(
		path,
		obstaclesFor(route, routing, spanOf(path, 0)),
		route.width,
	);
}

export function routeTrack(
	route: TrackRoute,
	routing: TrackRouting | undefined,
	budget: RouteBudget = { remaining: searchLimit },
): { points: Point[]; clear: boolean } {
	const { from, to } = route;
	const preferred = route.prefer && octant(route.prefer);
	const first = (path: readonly Point[]) =>
		path.length > 1
			? octant({ x: path[1].x - from.x, y: path[1].y - from.y })
			: preferred;
	const candidates = (["straight-first", "diagonal-first"] as const)
		.map((posture) => trackPath(from, to, posture))
		.sort(
			(a, b) => Number(first(a) !== preferred) - Number(first(b) !== preferred),
		);
	if (!routing) return { points: simplify(candidates[0]), clear: true };
	for (const pad of windows) {
		const area = spanOf([from, to], pad);
		const obstacles = obstaclesFor(route, routing, area);
		if (pad === windows[0]) {
			const clear = candidates.find((path) =>
				pathClear(path, obstacles, route.width),
			);
			if (clear) return { points: simplify(clear), clear: true };
		}
		if (budget.remaining <= 0) break;
		const found = search(route, obstacles, area, preferred, budget);
		if (found) {
			const points = simplify(found);
			if (pathClear(points, obstacles, route.width))
				return { points, clear: true };
		}
	}
	return { points: simplify(candidates[0]), clear: false };
}

function search(
	route: TrackRoute,
	obstacles: readonly Obstacle[],
	area: Bounds,
	preferred: number | undefined,
	budget: RouteBudget,
): Point[] | undefined {
	const { from, to, width } = route;
	const half = width / 2;
	const buckets = new Map<number, Obstacle[]>();
	for (const obstacle of obstacles)
		forBuckets(
			obstacle.bounds,
			(key) => {
				const list = buckets.get(key);
				if (list) list.push(obstacle);
				else buckets.set(key, [obstacle]);
			},
			1,
		);
	const minColumn = Math.floor((area.minX - from.x) / pitch);
	const maxColumn = Math.ceil((area.maxX - from.x) / pitch);
	const minRow = Math.floor((area.minY - from.y) / pitch);
	const maxRow = Math.ceil((area.maxY - from.y) / pitch);
	const columns = maxColumn - minColumn + 1;
	const cellOf = (column: number, row: number) =>
		(row - minRow) * columns + (column - minColumn);
	const pointOf = (column: number, row: number): Point => ({
		x: from.x + column * pitch,
		y: from.y + row * pitch,
	});
	const blocked = new Map<number, boolean>();
	const open = (column: number, row: number) => {
		if (column < minColumn || column > maxColumn) return false;
		if (row < minRow || row > maxRow) return false;
		const cell = cellOf(column, row);
		const known = blocked.get(cell);
		if (known !== undefined) return !known;
		const point = pointOf(column, row);
		const nearby =
			buckets.get(bucketKey(Math.floor(point.x), Math.floor(point.y))) ?? [];
		const free = nearby.every(
			({ hull, gap, bounds }) =>
				point.x < bounds.minX ||
				point.x > bounds.maxX ||
				point.y < bounds.minY ||
				point.y > bounds.maxY ||
				pointHullDistance(hull, point) >=
					half + gap + (gap > 0 ? margin : 0) - 1e-9,
		);
		blocked.set(cell, !free);
		return free;
	};
	const estimate = (column: number, row: number) => {
		const point = pointOf(column, row);
		const dx = Math.abs(to.x - point.x);
		const dy = Math.abs(to.y - point.y);
		return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
	};
	const goalColumn = Math.round((to.x - from.x) / pitch);
	const goalRow = Math.round((to.y - from.y) / pitch);
	const finish = (column: number, row: number, heading: number) => {
		if (Math.abs(column - goalColumn) > 2 || Math.abs(row - goalRow) > 2)
			return undefined;
		const point = pointOf(column, row);
		let best: { tail: Point[]; cost: number } | undefined;
		for (const posture of ["straight-first", "diagonal-first"] as const) {
			const tail = simplify(trackPath(point, to, posture));
			if (!pathClear(tail, obstacles, width)) continue;
			let cost = 0;
			let previous = heading === 8 ? undefined : heading;
			for (let index = 1; index < tail.length; index++) {
				const step = {
					x: tail[index].x - tail[index - 1].x,
					y: tail[index].y - tail[index - 1].y,
				};
				const direction = octant(step);
				cost += Math.hypot(step.x, step.y);
				if (previous !== undefined && direction !== previous) cost += bend;
				previous = direction;
			}
			if (!best || cost < best.cost) best = { tail, cost };
		}
		return best;
	};
	const tails = new Map<number, Point[]>();
	const scores = new Map<number, number>();
	const parents = new Map<number, number>();
	const headings = new Map<number, number>();
	const closed = new Set<number>();
	const heap: [number, number][] = [];
	const push = (id: number, key: number) => {
		heap.push([key, id]);
		let index = heap.length - 1;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (heap[parent][0] <= key) break;
			[heap[parent], heap[index]] = [heap[index], heap[parent]];
			index = parent;
		}
	};
	const pop = () => {
		const top = heap[0];
		const last = heap.pop() as [number, number];
		if (heap.length) {
			heap[0] = last;
			let index = 0;
			for (;;) {
				const left = index * 2 + 1;
				const right = left + 1;
				let best = index;
				if (left < heap.length && heap[left][0] < heap[best][0]) best = left;
				if (right < heap.length && heap[right][0] < heap[best][0]) best = right;
				if (best === index) break;
				[heap[best], heap[index]] = [heap[index], heap[best]];
				index = best;
			}
		}
		return top[1];
	};
	const start = cellOf(0, 0);
	scores.set(start, 0);
	push(start, estimate(0, 0));
	let expanded = 0;
	while (heap.length && expanded < searchLimit && budget.remaining > 0) {
		const id = pop();
		const tail = tails.get(id);
		if (tail) {
			const path: Point[] = [...tail.slice(1).reverse()];
			for (
				let at: number | undefined = -id - 1;
				at !== undefined;
				at = parents.get(at)
			)
				path.push(
					pointOf(
						(at % columns) + minColumn,
						Math.floor(at / columns) + minRow,
					),
				);
			return path.reverse();
		}
		if (closed.has(id)) continue;
		closed.add(id);
		expanded++;
		budget.remaining--;
		const heading = headings.get(id) ?? 8;
		const column = (id % columns) + minColumn;
		const row = Math.floor(id / columns) + minRow;
		const score = scores.get(id) ?? 0;
		const ending = finish(column, row, heading);
		if (ending) {
			tails.set(-id - 1, ending.tail);
			push(-id - 1, score + ending.cost);
		}
		for (let next = 0; next < 8; next++) {
			if (heading !== 8) {
				const turn = Math.abs(next - heading) % 8;
				if (Math.min(turn, 8 - turn) > 2) continue;
			}
			const [dx, dy] = directions[next];
			const nextColumn = column + dx;
			const nextRow = row + dy;
			if (!open(nextColumn, nextRow)) continue;
			if (dx && dy && (!open(column + dx, row) || !open(column, row + dy)))
				continue;
			const nextId = cellOf(nextColumn, nextRow);
			if (closed.has(nextId)) continue;
			const turned =
				heading === 8
					? preferred !== undefined && next !== preferred
					: next !== heading;
			const total =
				score + pitch * (dx && dy ? Math.SQRT2 : 1) + (turned ? bend : 0);
			if (total >= (scores.get(nextId) ?? Number.POSITIVE_INFINITY)) continue;
			scores.set(nextId, total);
			parents.set(nextId, id);
			headings.set(nextId, next);
			push(nextId, total + estimate(nextColumn, nextRow));
		}
	}
	return undefined;
}
