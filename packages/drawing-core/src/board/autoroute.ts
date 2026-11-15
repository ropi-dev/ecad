import {
	analyzeConnectivity,
	type CopperItem,
	type CopperLayer,
	copperItems,
	type RatsnestLine,
	type ZoneReach,
} from "#/board/connectivity.ts";
import {
	boardOutlineSegments,
	insideOutline,
	outlineBounds,
} from "#/board/drc.ts";
import { type Hull, hullDistance, lineEnds } from "#/board/geometry.ts";
import type { BoardNetlist } from "#/board/netlist.ts";
import type { BoardRules } from "#/board/rules.ts";
import type {
	EditorShape,
	FillableShape,
	LineShape,
} from "#/drawing/schema.ts";
import type { Point } from "#/drawing/types.ts";

export interface AutorouteOptions {
	rules: BoardRules;
	/** Grid pitch in millimetres. */
	grid?: number;
	/** Only these nets are routed. */
	nets?: ReadonlySet<string>;
	/** Nets routed after all others, such as ground. */
	last?: ReadonlySet<string>;
	/** Nets routed before all others. */
	first?: ReadonlySet<string>;
	/** Cost of a via in millimetres of track. */
	viaCost?: number;
	/** Extra cost per change of direction, in millimetres. */
	bendCost?: number;
	zoneReach?: ZoneReach;
	/** Search steps per connection before it is given up. */
	budget?: number;
	/** Connections tried in total, counting retries after rip-ups. */
	iterations?: number;
	/** Called with what happened to each connection, for diagnosis. */
	trace?: (event: string, line: RatsnestLine) => void;
}

export interface AutorouteResult {
	/** New tracks and vias, with IDs from `nextId` upwards. */
	shapes: EditorShape[];
	/** Connections no route was found for. */
	failed: RatsnestLine[];
}

export const layers: readonly CopperLayer[] = ["F.Cu", "B.Cu"];
export const free = -1;
export const blocked = -2;
export const directions = [
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
	[0, -1],
	[1, -1],
] as const;

export class Heap {
	readonly keys: number[] = [];
	readonly values: number[] = [];
	get size() {
		return this.keys.length;
	}
	push(value: number, key: number) {
		const { keys, values } = this;
		let index = keys.length;
		keys.push(key);
		values.push(value);
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (keys[parent] <= key) break;
			keys[index] = keys[parent];
			values[index] = values[parent];
			index = parent;
		}
		keys[index] = key;
		values[index] = value;
	}
	pop(): number {
		const { keys, values } = this;
		const top = values[0];
		const lastKey = keys.pop() as number;
		const lastValue = values.pop() as number;
		if (keys.length) {
			let index = 0;
			for (;;) {
				const left = 2 * index + 1;
				if (left >= keys.length) break;
				const right = left + 1;
				const child =
					right < keys.length && keys[right] < keys[left] ? right : left;
				if (keys[child] >= lastKey) break;
				keys[index] = keys[child];
				values[index] = values[child];
				index = child;
			}
			keys[index] = lastKey;
			values[index] = lastValue;
		}
		return top;
	}
}

interface Route {
	net: string;
	owner: number;
	shapes: EditorShape[];
	alive: boolean;
}

/**
 * Routes unrouted connections one at a time with an A* search over a grid
 * on both copper layers. A cell is open to a net when it keeps the track,
 * or a via placed there, the board clearance away from other nets' copper
 * and the edge clearance away from the outline. When earlier routes block a
 * connection, a second search may cross them at a cost; the routes it
 * crosses are ripped up and routed again later. Each rip-up makes crossing
 * that net dearer, so two nets cannot keep evicting each other.
 */
export function autoroute(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	nextId: number,
	options: AutorouteOptions,
): AutorouteResult {
	const { rules } = options;
	const pitch = options.grid ?? 0.1;
	const width = rules.trackWidth;
	const viaRadius = rules.viaDiameter / 2;
	const margin = pitch * 0.25;
	const outline = boardOutlineSegments(shapes);
	const bounds = outlineBounds(outline);
	if (!bounds) return { shapes: [], failed: [] };
	const originX = Math.floor(bounds.minX / pitch) * pitch;
	const originY = Math.floor(bounds.minY / pitch) * pitch;
	const columns = Math.ceil((bounds.maxX - originX) / pitch) + 1;
	const rows = Math.ceil((bounds.maxY - originY) / pitch) + 1;
	const cells = columns * rows;
	const netIndex = new Map<string, number>();
	const indexOf = (net: string | undefined) => {
		if (net === undefined) return blocked;
		let index = netIndex.get(net);
		if (index === undefined) {
			index = netIndex.size;
			netIndex.set(net, index);
		}
		return index;
	};
	const grids = () => layers.map(() => new Int32Array(cells).fill(free));
	const baseTrack = grids();
	const baseVia = grids();
	const nearGrid = grids();
	const trackGrid = grids();
	const viaGrid = grids();
	const routeGrid = grids();
	const nearReach = rules.clearance + width / 2 + 0.4;
	const reachTrack = rules.clearance + width / 2 + margin;
	const reachVia = rules.clearance + viaRadius + margin;
	const center = (cell: number): Point => ({
		x: originX + (cell % columns) * pitch,
		y: originY + Math.floor(cell / columns) * pitch,
	});
	const claim = (grid: Int32Array, cell: number, owner: number) => {
		const current = grid[cell];
		if (current === free) grid[cell] = owner;
		else if (current !== owner) grid[cell] = blocked;
	};
	const mark = (
		hull: Hull,
		layer: number,
		owner: number,
		target: { track: Int32Array[]; via: Int32Array[] },
		pad = false,
		route = -1,
	) => {
		const reach = Math.max(reachTrack, reachVia, pad ? nearReach : 0);
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const point of hull.points) {
			minX = Math.min(minX, point.x);
			minY = Math.min(minY, point.y);
			maxX = Math.max(maxX, point.x);
			maxY = Math.max(maxY, point.y);
		}
		const extent = hull.radius + reach;
		const firstColumn = Math.max(
			0,
			Math.floor((minX - extent - originX) / pitch),
		);
		const lastColumn = Math.min(
			columns - 1,
			Math.ceil((maxX + extent - originX) / pitch),
		);
		const firstRow = Math.max(0, Math.floor((minY - extent - originY) / pitch));
		const lastRow = Math.min(
			rows - 1,
			Math.ceil((maxY + extent - originY) / pitch),
		);
		const probe: Hull = { points: [{ x: 0, y: 0 }], radius: 0 };
		const point = probe.points[0] as Point;
		for (let row = firstRow; row <= lastRow; row++)
			for (let column = firstColumn; column <= lastColumn; column++) {
				point.x = originX + column * pitch;
				point.y = originY + row * pitch;
				const distance = hullDistance(hull, probe);
				if (distance >= reach) continue;
				const cell = row * columns + column;
				if (pad && distance < nearReach) claim(nearGrid[layer], cell, owner);
				if (distance < reachTrack) claim(target.track[layer], cell, owner);
				if (distance < reachVia) claim(target.via[layer], cell, owner);
				if (route >= 0 && distance < reachVia) routeGrid[layer][cell] = route;
			}
	};
	const base = { track: baseTrack, via: baseVia };
	for (const item of copperItems(shapes, netlist)) {
		if (item.kind === "zone") continue;
		const owner = indexOf(item.net);
		for (const layer of item.layers)
			for (const hull of item.hulls)
				mark(
					hull,
					layers.indexOf(layer),
					owner,
					base,
					item.kind === "pad" || item.kind === "track",
				);
	}
	{
		const edgeTrack = rules.edgeClearance + width / 2;
		const edgeVia = rules.edgeClearance + viaRadius;
		for (let cell = 0; cell < cells; cell++) {
			const point = center(cell);
			let edge = Infinity;
			for (const [a, b] of outline)
				edge = Math.min(
					edge,
					hullDistance(
						{ points: [a, b], radius: 0 },
						{ points: [point], radius: 0 },
					),
				);
			const inside = insideOutline(point, outline);
			for (let layer = 0; layer < layers.length; layer++) {
				if (!inside || edge < edgeTrack) baseTrack[layer][cell] = blocked;
				if (!inside || edge < edgeVia) baseVia[layer][cell] = blocked;
			}
		}
	}

	const routes: Route[] = [];
	const routeHulls = (route: Route) =>
		route.shapes.flatMap((shape) =>
			shape.kind === "line"
				? [
						{
							layers: [layers.indexOf(shape.layer as CopperLayer)],
							hull: { points: lineEnds(shape), radius: width / 2 },
						},
					]
				: [
						{
							layers: [0, 1],
							hull: { points: [{ x: shape.x, y: shape.y }], radius: viaRadius },
						},
					],
		);
	const live = { track: trackGrid, via: viaGrid };
	const rebuild = () => {
		for (let layer = 0; layer < layers.length; layer++) {
			trackGrid[layer].set(baseTrack[layer]);
			viaGrid[layer].set(baseVia[layer]);
			routeGrid[layer].fill(free);
		}
		routes.forEach((route, index) => {
			if (!route.alive) return;
			for (const { layers: on, hull } of routeHulls(route))
				for (const layer of on)
					mark(hull, layer, route.owner, live, false, index);
		});
	};

	const open = (grid: Int32Array, cell: number, owner: number) =>
		grid[cell] === free || grid[cell] === owner;
	const viaCost = options.viaCost ?? 1.5;
	const bendCost = options.bendCost ?? pitch * 2;
	const budget = options.budget ?? 2 * cells * layers.length;
	const strictBudget = 150_000;
	const ripCost = 3;
	const ripped = new Map<number, number>();
	const cost = new Float32Array(cells * layers.length);
	const parent = new Int32Array(cells * layers.length);
	const heading = new Int8Array(cells * layers.length);
	const closed = new Uint8Array(cells * layers.length);
	const visited: number[] = [];
	const cellsInside = (item: CopperItem) => {
		const result: number[] = [];
		for (const layer of item.layers) {
			const z = layers.indexOf(layer);
			const { minX, minY, maxX, maxY } = item.bounds;
			for (
				let row = Math.max(0, Math.ceil((minY - originY) / pitch));
				row <= Math.min(rows - 1, Math.floor((maxY - originY) / pitch));
				row++
			)
				for (
					let column = Math.max(0, Math.ceil((minX - originX) / pitch));
					column <= Math.min(columns - 1, Math.floor((maxX - originX) / pitch));
					column++
				) {
					const cell = row * columns + column;
					const point = center(cell);
					if (
						item.hulls.some(
							(hull) =>
								hullDistance(hull, { points: [point], radius: 0 }) <= 1e-9,
						)
					)
						result.push(z * cells + cell);
				}
		}
		return result;
	};
	/**
	 * A* from any source state to any target state. With `crossing`, earlier
	 * routes of other nets are passable at a cost that grows each time their
	 * net has been ripped up.
	 */
	const search = (
		owner: number,
		sources: readonly number[],
		targets: ReadonlySet<number>,
		goal: Point,
		crossing: boolean,
	): number[] | undefined => {
		for (const state of visited) {
			cost[state] = 0;
			parent[state] = 0;
			heading[state] = 0;
			closed[state] = 0;
		}
		visited.length = 0;
		const track = crossing ? baseTrack : trackGrid;
		const via = crossing ? baseVia : viaGrid;
		const penalty = (z: number, cell: number) => {
			if (!crossing) return 0;
			const route = routeGrid[z][cell];
			if (route === free) return 0;
			const other = routes[route];
			if (!other?.alive || other.owner === owner) return 0;
			return ripCost * (1 + (ripped.get(other.owner) ?? 0));
		};
		const heap = new Heap();
		const estimate = (cell: number) => {
			const point = center(cell);
			const dx = Math.abs(point.x - goal.x);
			const dy = Math.abs(point.y - goal.y);
			return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
		};
		for (const state of sources) {
			if (!open(track[Math.floor(state / cells)], state % cells, owner))
				continue;
			cost[state] = 1e-6;
			parent[state] = -1;
			heading[state] = 8;
			visited.push(state);
			heap.push(state, estimate(state % cells));
		}
		let steps = 0;
		const limit = crossing ? budget : Math.min(budget, strictBudget);
		while (heap.size && steps < limit) {
			const state = heap.pop();
			if (closed[state]) continue;
			closed[state] = 1;
			steps++;
			if (targets.has(state)) {
				const path: number[] = [];
				for (let at = state; at >= 0; at = parent[at]) path.push(at);
				return path.reverse();
			}
			const z = Math.floor(state / cells);
			const cell = state % cells;
			const column = cell % columns;
			const row = Math.floor(cell / columns);
			const reached = cost[state];
			const from = heading[state];
			const relax = (next: number, step: number, direction: number) => {
				const total =
					reached + step + (from !== 8 && direction !== from ? bendCost : 0);
				if (closed[next] || (cost[next] && cost[next] <= total)) return;
				if (!cost[next]) visited.push(next);
				cost[next] = total;
				parent[next] = state;
				heading[next] = direction;
				heap.push(next, total + estimate(next % cells));
			};
			for (let direction = 0; direction < 8; direction++) {
				const [dx, dy] = directions[direction];
				const nextColumn = column + dx;
				const nextRow = row + dy;
				if (
					nextColumn < 0 ||
					nextRow < 0 ||
					nextColumn >= columns ||
					nextRow >= rows
				)
					continue;
				const nextCell = nextRow * columns + nextColumn;
				const grid = track[z];
				if (!open(grid, nextCell, owner)) continue;
				if (
					dx &&
					dy &&
					(!open(grid, row * columns + nextColumn, owner) ||
						!open(grid, nextRow * columns + column, owner))
				)
					continue;
				const near = nearGrid[z][nextCell];
				relax(
					z * cells + nextCell,
					(dx && dy ? pitch * Math.SQRT2 : pitch) +
						(near !== free && near !== owner ? pitch * 8 : 0) +
						penalty(z, nextCell),
					direction,
				);
			}
			const other = 1 - z;
			if (
				open(via[0], cell, owner) &&
				open(via[1], cell, owner) &&
				open(track[other], cell, owner)
			)
				relax(
					other * cells + cell,
					viaCost + penalty(0, cell) + penalty(1, cell),
					8,
				);
		}
		lastSteps = steps;
		lastQueue = heap.size;
		return undefined;
	};
	let lastSteps = 0;
	let lastQueue = 0;

	const trackShape = (
		from: Point,
		to: Point,
		layer: CopperLayer,
		net: string,
	): LineShape => {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		return {
			id: 0,
			kind: "line",
			layer,
			x: (from.x + to.x) / 2,
			y: (from.y + to.y) / 2,
			width: Math.hypot(dx, dy),
			height: 1,
			rotation: Math.atan2(dy, dx),
			lineWidth: width,
			net,
		};
	};
	const viaShape = (at: Point, net: string): FillableShape => ({
		id: 0,
		kind: "circle",
		layer: "F.Cu",
		x: at.x,
		y: at.y,
		width: rules.viaDiameter,
		height: rules.viaDiameter,
		rotation: 0,
		lineWidth: 0.15,
		filled: true,
		via: { drill: rules.viaDrill },
		net,
	});
	const pathShapes = (path: readonly number[], net: string): EditorShape[] => {
		const result: EditorShape[] = [];
		let run: Point[] = [];
		let runLayer = Math.floor(path[0] / cells);
		const flush = () => {
			const corners: Point[] = [];
			for (const point of run) {
				const previous = corners[corners.length - 1];
				const before = corners[corners.length - 2];
				if (
					before &&
					previous &&
					Math.abs(
						(previous.x - before.x) * (point.y - previous.y) -
							(previous.y - before.y) * (point.x - previous.x),
					) < 1e-9
				)
					corners[corners.length - 1] = point;
				else corners.push(point);
			}
			for (let index = 1; index < corners.length; index++)
				result.push(
					trackShape(corners[index - 1], corners[index], layers[runLayer], net),
				);
		};
		for (const state of path) {
			const z = Math.floor(state / cells);
			const point = center(state % cells);
			if (z !== runLayer) {
				flush();
				result.push(viaShape(point, net));
				run = [];
				runLayer = z;
			}
			run.push(point);
		}
		flush();
		return result;
	};
	const crossedRoutes = (added: readonly EditorShape[], owner: number) => {
		const mine = routeHulls({
			net: "",
			owner,
			shapes: [...added],
			alive: true,
		});
		const crossed = new Set<number>();
		routes.forEach((route, index) => {
			if (!route.alive || route.owner === owner) return;
			for (const theirs of routeHulls(route))
				for (const ours of mine)
					if (
						theirs.layers.some((layer) => ours.layers.includes(layer)) &&
						hullDistance(theirs.hull, ours.hull) < rules.clearance + 1e-6
					) {
						crossed.add(index);
						return;
					}
		});
		return crossed;
	};

	const failed: RatsnestLine[] = [];
	const given = new Set<string>();
	const attempts = new Map<string, number>();
	const wanted = (net: string) => !options.nets || options.nets.has(net);
	const key = (line: RatsnestLine) =>
		`${line.net}:${line.from.x},${line.from.y}:${line.to.x},${line.to.y}`;
	const maxIterations = options.iterations ?? 1500;
	for (let iteration = 0; iteration < maxIterations; iteration++) {
		const current = [
			...shapes,
			...routes.flatMap((route) => (route.alive ? route.shapes : [])),
		];
		const items = copperItems(current, netlist);
		const connectivity = analyzeConnectivity(items, options.zoneReach);
		const pending = connectivity.ratsnest
			.filter((line) => wanted(line.net) && !given.has(key(line)))
			.sort(
				(a, b) =>
					Number(options.first?.has(b.net) ?? false) -
						Number(options.first?.has(a.net) ?? false) ||
					Number(options.last?.has(a.net) ?? false) -
						Number(options.last?.has(b.net) ?? false) ||
					(attempts.get(key(b)) ?? 0) - (attempts.get(key(a)) ?? 0) ||
					Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) -
						Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y),
			);
		const line = pending[0];
		if (!line) break;
		const tries = (attempts.get(key(line)) ?? 0) + 1;
		attempts.set(key(line), tries);
		const near = (point: Point, item: CopperItem) =>
			item.points.some(
				(candidate) =>
					Math.abs(candidate.x - point.x) < 1e-9 &&
					Math.abs(candidate.y - point.y) < 1e-9,
			);
		const sourceItem = items.find(
			(item) => item.net === line.net && near(line.from, item),
		);
		const targetItem = items.find(
			(item) => item.net === line.net && near(line.to, item),
		);
		if (!sourceItem || !targetItem) {
			given.add(key(line));
			failed.push(line);
			continue;
		}
		const group = (root: number) =>
			items.filter(
				(item) =>
					item.net === line.net &&
					connectivity.group[item.index] === root &&
					item.kind !== "zone",
			);
		const owner = indexOf(line.net);
		const sources = group(connectivity.group[sourceItem.index]).flatMap(
			cellsInside,
		);
		const targets = new Set(
			group(connectivity.group[targetItem.index]).flatMap(cellsInside),
		);
		rebuild();
		options.trace?.(`try ${tries}`, line);
		let path = search(owner, sources, targets, line.to, false);
		let added = path && pathShapes(path, line.net);
		if (!path && tries <= 16) {
			path = search(owner, sources, targets, line.to, true);
			added = path && pathShapes(path, line.net);
			if (added)
				for (const route of crossedRoutes(added, owner)) {
					routes[route].alive = false;
					ripped.set(
						routes[route].owner,
						(ripped.get(routes[route].owner) ?? 0) + 1,
					);
				}
		}
		if (!added) {
			options.trace?.(
				`failed after ${lastSteps} steps, queue ${lastQueue}`,
				line,
			);
			given.add(key(line));
			failed.push(line);
			continue;
		}
		routes.push({ net: line.net, owner, shapes: added, alive: true });
	}
	let id = nextId;
	const output = routes
		.filter((route) => route.alive)
		.flatMap((route) => route.shapes.map((shape) => ({ ...shape, id: id++ })));
	const finalItems = copperItems([...shapes, ...output], netlist);
	const remaining = analyzeConnectivity(
		finalItems,
		options.zoneReach,
	).ratsnest.filter((line) => wanted(line.net));
	return { shapes: output, failed: remaining };
}

/**
 * Routes several times, each time starting with the nets the previous
 * attempts could not finish, and keeps the attempt with the fewest failures.
 */
export function autorouteWithRetries(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	nextId: number,
	options: AutorouteOptions & { attempts?: number },
): AutorouteResult {
	let best: AutorouteResult | undefined;
	const first = new Set(options.first ?? []);
	for (let attempt = 0; attempt < (options.attempts ?? 2); attempt++) {
		const result = autoroute(shapes, netlist, nextId, { ...options, first });
		if (!best || result.failed.length < best.failed.length) best = result;
		if (!result.failed.length) break;
		for (const line of result.failed)
			if (!options.last?.has(line.net)) first.add(line.net);
	}
	return best as AutorouteResult;
}
