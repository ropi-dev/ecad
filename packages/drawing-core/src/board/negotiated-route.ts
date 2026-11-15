import type { AutorouteResult } from "#/board/autoroute.ts";
import {
	analyzeConnectivity,
	type CopperItem,
	copperItems,
	type ZoneReach,
} from "#/board/connectivity.ts";
import type { BoardNetlist } from "#/board/netlist.ts";
import {
	bendCost,
	directions,
	free,
	Heap,
	layers,
	open,
	pitch,
	routingGrid,
	viaCost,
} from "#/board/routing-grid.ts";
import type { BoardRules } from "#/board/rules.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import type { Point } from "#/drawing/types.ts";

export interface NegotiatedRouteOptions {
	rules: BoardRules;
	zoneReach?: ZoneReach;
	/** Rounds of rerouting every net before giving up on overlaps. */
	rounds?: number;
	/** Nets left alone, such as a ground that zones connect. */
	exclude?: ReadonlySet<string>;
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
	const grid = routingGrid(shapes, netlist, rules);
	if (!grid) return { shapes: [], failed: [] };
	const {
		items,
		columns,
		rows,
		cells,
		width,
		viaRadius,
		margin,
		base,
		near,
		indexOf,
		center,
		cellsInside,
		pathShapes,
	} = grid;
	const states = cells * layers.length;
	const baseTrack = base.track;
	const baseVia = base.via;

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

	const wanted = (net: string) => !options.exclude?.has(net);
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

	const cost = new Float32Array(states);
	const parent = new Int32Array(states);
	const heading = new Int8Array(states);
	const closed = new Uint8Array(states);
	const visited: number[] = [];
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
					if (usageTrack[state] > 1) history[state] += 0.3;
		}
		options.progress?.(round, contested);
		if (!contested) break;
		present *= 1.5;
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
	const output: EditorShape[] = kept.flatMap((route) =>
		route.paths.flatMap((path) =>
			pathShapes(path, route.net).map((shape) => ({ ...shape, id: id++ })),
		),
	);
	const remaining = analyzeConnectivity(
		copperItems([...shapes, ...output], netlist),
		options.zoneReach,
	).ratsnest.filter((line) => wanted(line.net));
	return { shapes: output, failed: remaining };
}
