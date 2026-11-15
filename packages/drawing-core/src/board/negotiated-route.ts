import {
	type AutorouteOptions,
	type AutorouteResult,
	blocked,
	directions,
	free,
	Heap,
	layers,
} from "#/board/autoroute.ts";
import {
	analyzeConnectivity,
	type CopperItem,
	type CopperLayer,
	copperItems,
} from "#/board/connectivity.ts";
import {
	boardOutlineSegments,
	insideOutline,
	outlineBounds,
} from "#/board/drc.ts";
import { type Hull, hullDistance } from "#/board/geometry.ts";
import type { BoardNetlist } from "#/board/netlist.ts";
import type {
	EditorShape,
	FillableShape,
	LineShape,
} from "#/drawing/schema.ts";
import type { Point } from "#/drawing/types.ts";

export interface NegotiatedRouteOptions extends AutorouteOptions {
	/** Rounds of rerouting every net before giving up on overlaps. */
	rounds?: number;
	/** Nets left alone, such as a ground that zones connect. */
	exclude?: ReadonlySet<string>;
	/** History cost added to a shared cell after each round. */
	historyCost?: number;
	/** Factor the price of sharing grows by after each round. */
	presentGrowth?: number;
	/** Called once per round with the number of overlapping nets. */
	progress?: (round: number, overlapping: number) => void;
}

interface NetRoute {
	net: string;
	owner: number;
	/** Each path as grid states, `layer * cells + cell`. */
	paths: number[][];
	/** States where a via is placed. */
	vias: number[];
	marked: { track: number[]; via: number[] };
	complete: boolean;
}

function disk(radius: number, pitch: number): [number, number][] {
	const reach = Math.ceil(radius / pitch);
	const offsets: [number, number][] = [];
	for (let dy = -reach; dy <= reach; dy++)
		for (let dx = -reach; dx <= reach; dx++)
			if (Math.hypot(dx, dy) * pitch < radius) offsets.push([dx, dy]);
	return offsets;
}

/**
 * Negotiated congestion routing, after PathFinder: every net is routed in
 * turn on a grid over both copper layers, and may share space with other
 * nets' routes at a price. After each round the price of sharing rises, and
 * cells that were shared keep a growing history cost, until no two nets
 * share space. Fixed copper, the outline and other nets' pads are never
 * crossed. Nets that still overlap after the last round are left unrouted.
 */
export function negotiatedRoute(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	nextId: number,
	options: NegotiatedRouteOptions,
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
	const states = cells * layers.length;
	const center = (cell: number): Point => ({
		x: originX + (cell % columns) * pitch,
		y: originY + Math.floor(cell / columns) * pitch,
	});
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

	const baseTrack = layers.map(() => new Int32Array(cells).fill(free));
	const baseVia = layers.map(() => new Int32Array(cells).fill(free));
	const near = layers.map(() => new Int32Array(cells).fill(free));
	const reachTrack = rules.clearance + width / 2 + margin;
	const reachVia = rules.clearance + viaRadius + margin;
	const nearReach = rules.clearance + width / 2 + 0.4;
	const claim = (grid: Int32Array, cell: number, owner: number) => {
		const current = grid[cell];
		if (current === free) grid[cell] = owner;
		else if (current !== owner) grid[cell] = blocked;
	};
	const markFixed = (
		hull: Hull,
		layer: number,
		owner: number,
		close: boolean,
	) => {
		const reach = Math.max(reachTrack, reachVia, close ? nearReach : 0);
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
		const probe: Hull = { points: [{ x: 0, y: 0 }], radius: 0 };
		const point = probe.points[0] as Point;
		for (
			let row = Math.max(0, Math.floor((minY - extent - originY) / pitch));
			row <= Math.min(rows - 1, Math.ceil((maxY + extent - originY) / pitch));
			row++
		)
			for (
				let column = Math.max(0, Math.floor((minX - extent - originX) / pitch));
				column <=
				Math.min(columns - 1, Math.ceil((maxX + extent - originX) / pitch));
				column++
			) {
				point.x = originX + column * pitch;
				point.y = originY + row * pitch;
				const distance = hullDistance(hull, probe);
				if (distance >= reach) continue;
				const cell = row * columns + column;
				if (close && distance < nearReach) claim(near[layer], cell, owner);
				if (distance < reachTrack) claim(baseTrack[layer], cell, owner);
				if (distance < reachVia) claim(baseVia[layer], cell, owner);
			}
	};
	const items = copperItems(shapes, netlist);
	for (const item of items) {
		if (item.kind === "zone") continue;
		const owner = indexOf(item.net);
		for (const layer of item.layers)
			for (const hull of item.hulls)
				markFixed(
					hull,
					layers.indexOf(layer),
					owner,
					item.kind === "pad" || item.kind === "track",
				);
	}
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
			if (!inside || edge < rules.edgeClearance + width / 2)
				baseTrack[layer][cell] = blocked;
			if (!inside || edge < rules.edgeClearance + viaRadius)
				baseVia[layer][cell] = blocked;
		}
	}

	const usageTrack = new Uint16Array(states);
	const usageVia = new Uint16Array(states);
	const stampTrack = new Int32Array(states).fill(-1);
	const stampVia = new Int32Array(states).fill(-1);
	const history = new Float32Array(states);
	const trackOnTrack = disk(width + rules.clearance + margin, pitch);
	const viaOnTrack = disk(
		width / 2 + rules.clearance + viaRadius + margin,
		pitch,
	);
	const trackOnVia = viaOnTrack;
	const viaOnVia = disk(2 * viaRadius + rules.clearance + margin, pitch);

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

	const wanted = (net: string) =>
		(!options.nets || options.nets.has(net)) && !options.exclude?.has(net);
	const connectivity = analyzeConnectivity(items, options.zoneReach);
	const groupsByNet = new Map<string, Map<number, CopperItem[]>>();
	for (const item of items) {
		if (!item.net || item.kind === "zone" || !wanted(item.net)) continue;
		let groups = groupsByNet.get(item.net);
		if (!groups) {
			groups = new Map();
			groupsByNet.set(item.net, groups);
		}
		const root = connectivity.group[item.index];
		const group = groups.get(root);
		if (group) group.push(item);
		else groups.set(root, [item]);
	}
	const nets = [...groupsByNet]
		.filter(([, groups]) => groups.size > 1)
		.map(([net, groups]) => ({
			net,
			owner: indexOf(net),
			groups: [...groups.values()].map((group) => {
				const states = group.flatMap(cellsInside);
				const xs = group.flatMap((item) => item.points.map((p) => p.x));
				const ys = group.flatMap((item) => item.points.map((p) => p.y));
				return {
					states,
					center: {
						x: xs.reduce((sum, x) => sum + x, 0) / Math.max(1, xs.length),
						y: ys.reduce((sum, y) => sum + y, 0) / Math.max(1, ys.length),
					},
				};
			}),
		}))
		.filter((entry) => entry.groups.every((group) => group.states.length));

	const open = (grid: Int32Array, cell: number, owner: number) =>
		grid[cell] === free || grid[cell] === owner;
	const cost = new Float32Array(states);
	const parent = new Int32Array(states);
	const heading = new Int8Array(states);
	const closed = new Uint8Array(states);
	const visited: number[] = [];
	const viaCost = options.viaCost ?? 1.5;
	const bendCost = options.bendCost ?? pitch * 2;
	let present = 0.5;

	const search = (
		owner: number,
		sources: readonly number[],
		targets: ReadonlyMap<number, number>,
		goals: readonly Point[],
	): number[] | undefined => {
		for (const state of visited) {
			cost[state] = 0;
			parent[state] = 0;
			heading[state] = 0;
			closed[state] = 0;
		}
		visited.length = 0;
		const heap = new Heap();
		const estimate = (cell: number) => {
			const point = center(cell);
			let best = Infinity;
			for (const goal of goals) {
				const dx = Math.abs(point.x - goal.x);
				const dy = Math.abs(point.y - goal.y);
				best = Math.min(
					best,
					Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy),
				);
			}
			return best;
		};
		const sharing = (usage: Uint16Array, state: number) =>
			usage[state] ? present * usage[state] : 0;
		for (const state of sources) {
			if (!open(baseTrack[Math.floor(state / cells)], state % cells, owner))
				continue;
			if (cost[state]) continue;
			cost[state] = 1e-6;
			parent[state] = -1;
			heading[state] = 8;
			visited.push(state);
			heap.push(state, estimate(state % cells));
		}
		while (heap.size) {
			const state = heap.pop();
			if (closed[state]) continue;
			closed[state] = 1;
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
				if (closed[next]) return;
				const total =
					reached + step + (from !== 8 && direction !== from ? bendCost : 0);
				if (cost[next] && cost[next] <= total) return;
				if (!cost[next]) visited.push(next);
				cost[next] = total;
				parent[next] = state;
				heading[next] = direction;
				heap.push(next, total + estimate(next % cells));
			};
			const grid = baseTrack[z];
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
				if (!open(grid, nextCell, owner)) continue;
				if (
					dx &&
					dy &&
					(!open(grid, row * columns + nextColumn, owner) ||
						!open(grid, nextRow * columns + column, owner))
				)
					continue;
				const next = z * cells + nextCell;
				const nearby = near[z][nextCell];
				const length =
					(dx && dy ? pitch * Math.SQRT2 : pitch) +
					(nearby !== free && nearby !== owner ? pitch * 8 : 0);
				relax(
					next,
					length * (1 + history[next]) + sharing(usageTrack, next),
					direction,
				);
			}
			const other = 1 - z;
			if (
				open(baseVia[0], cell, owner) &&
				open(baseVia[1], cell, owner) &&
				open(baseTrack[other], cell, owner)
			)
				relax(
					other * cells + cell,
					viaCost * (1 + history[cell] + history[cells + cell]) +
						sharing(usageVia, cell) +
						sharing(usageVia, cells + cell),
					8,
				);
		}
		return undefined;
	};

	const stamp = (
		route: NetRoute,
		state: number,
		offsets: readonly [number, number][],
		usage: Uint16Array,
		stamps: Int32Array,
		marked: number[],
	) => {
		const z = Math.floor(state / cells);
		const cell = state % cells;
		const column = cell % columns;
		const row = Math.floor(cell / columns);
		for (const [dx, dy] of offsets) {
			const x = column + dx;
			const y = row + dy;
			if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
			const target = z * cells + y * columns + x;
			if (stamps[target] === route.owner) continue;
			stamps[target] = route.owner;
			usage[target]++;
			marked.push(target);
		}
	};
	const mark = (route: NetRoute) => {
		for (const path of route.paths)
			for (const state of path) {
				stamp(
					route,
					state,
					trackOnTrack,
					usageTrack,
					stampTrack,
					route.marked.track,
				);
				stamp(route, state, trackOnVia, usageVia, stampVia, route.marked.via);
			}
		for (const state of route.vias)
			for (const layer of [0, 1]) {
				const onLayer = layer * cells + (state % cells);
				stamp(
					route,
					onLayer,
					viaOnTrack,
					usageTrack,
					stampTrack,
					route.marked.track,
				);
				stamp(route, onLayer, viaOnVia, usageVia, stampVia, route.marked.via);
			}
	};
	const unmark = (route: NetRoute) => {
		for (const state of route.marked.track) {
			usageTrack[state]--;
			stampTrack[state] = -1;
		}
		for (const state of route.marked.via) {
			usageVia[state]--;
			stampVia[state] = -1;
		}
		route.marked = { track: [], via: [] };
	};
	const routeNet = (entry: (typeof nets)[number]): NetRoute => {
		const route: NetRoute = {
			net: entry.net,
			owner: entry.owner,
			paths: [],
			vias: [],
			marked: { track: [], via: [] },
			complete: true,
		};
		const tree = [...entry.groups[0].states];
		const remaining = new Set(
			entry.groups.slice(1).map((_, index) => index + 1),
		);
		while (remaining.size) {
			const targets = new Map<number, number>();
			for (const index of remaining)
				for (const state of entry.groups[index].states)
					targets.set(state, index);
			const path = search(
				entry.owner,
				tree,
				targets,
				[...remaining].map((index) => entry.groups[index].center),
			);
			if (!path) {
				route.complete = false;
				break;
			}
			const reached = targets.get(path[path.length - 1]) as number;
			remaining.delete(reached);
			route.paths.push(path);
			for (let index = 1; index < path.length; index++)
				if (
					Math.floor(path[index] / cells) !==
					Math.floor(path[index - 1] / cells)
				)
					route.vias.push(path[index]);
			tree.push(...path, ...entry.groups[reached].states);
		}
		return route;
	};
	const overlapping = (route: NetRoute) => {
		for (const path of route.paths)
			for (const state of path) if (usageTrack[state] > 1) return true;
		for (const state of route.vias)
			if (usageVia[state % cells] > 1 || usageVia[cells + (state % cells)] > 1)
				return true;
		return false;
	};

	const routes = new Map<string, NetRoute>();
	const rounds = options.rounds ?? 40;
	for (let round = 0; round < rounds; round++) {
		for (const entry of nets) {
			const previous = routes.get(entry.net);
			if (previous) unmark(previous);
			const route = routeNet(entry);
			mark(route);
			routes.set(entry.net, route);
		}
		let contested = 0;
		for (const route of routes.values()) {
			if (!overlapping(route)) continue;
			contested++;
			for (const path of route.paths)
				for (const state of path)
					if (usageTrack[state] > 1)
						history[state] += options.historyCost ?? 0.3;
		}
		options.progress?.(round, contested);
		if (!contested) break;
		present *= options.presentGrowth ?? 1.5;
	}

	// Keep nets in order while they overlap nothing kept before them.
	for (const route of routes.values()) unmark(route);
	const kept: NetRoute[] = [];
	for (const route of routes.values()) {
		if (!route.complete) continue;
		mark(route);
		if (overlapping(route)) unmark(route);
		else kept.push(route);
	}

	let id = nextId;
	const output: EditorShape[] = [];
	const addTrack = (
		from: Point,
		to: Point,
		layer: CopperLayer,
		net: string,
	) => {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const track: LineShape = {
			id: id++,
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
		output.push(track);
	};
	const addVia = (at: Point, net: string) => {
		const via: FillableShape = {
			id: id++,
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
		};
		output.push(via);
	};
	for (const route of kept)
		for (const path of route.paths) {
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
					addTrack(
						corners[index - 1],
						corners[index],
						layers[runLayer],
						route.net,
					);
			};
			for (const state of path) {
				const z = Math.floor(state / cells);
				const point = center(state % cells);
				if (z !== runLayer) {
					flush();
					addVia(point, route.net);
					run = [];
					runLayer = z;
				}
				run.push(point);
			}
			flush();
		}
	const remaining = analyzeConnectivity(
		copperItems([...shapes, ...output], netlist),
		options.zoneReach,
	).ratsnest.filter((line) => wanted(line.net));
	return { shapes: output, failed: remaining };
}
