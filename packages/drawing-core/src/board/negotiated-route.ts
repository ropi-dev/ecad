import {
	analyzeConnectivity,
	type CopperItem,
	copperItems,
} from "#/board/connectivity.ts";
import type { BoardNetlist } from "#/board/netlist.ts";
import {
	layers,
	pitch,
	type RoutingResult,
	routingGrid,
	viaCost,
} from "#/board/routing-grid.ts";
import type { BoardRules } from "#/board/rules.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import type { Point } from "#/drawing/types.ts";

export interface NegotiatedRouteOptions {
	rules: BoardRules;
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

function disk(radius: number): [number, number][] {
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
): RoutingResult {
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
		indexOf,
		cellsInside,
		pathShapes,
	} = grid;
	const states = cells * layers.length;

	const usageTrack = new Uint16Array(states);
	const usageVia = new Uint16Array(states);
	const stampTrack = new Int32Array(states).fill(-1);
	const stampVia = new Int32Array(states).fill(-1);
	const history = new Float32Array(states);
	const trackOnTrack = disk(width + rules.clearance + margin);
	const viaOnTrack = disk(width / 2 + rules.clearance + viaRadius + margin);
	const viaOnVia = disk(2 * viaRadius + rules.clearance + margin);

	const wanted = (net: string) => !options.exclude?.has(net);
	const connectivity = analyzeConnectivity(items);
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

	let present = 0.5;
	const sharing = (usage: Uint16Array, state: number) =>
		usage[state] ? present * usage[state] : 0;
	const search = (
		owner: number,
		sources: readonly number[],
		targets: ReadonlyMap<number, number>,
		goals: readonly Point[],
	) =>
		grid.search({
			owner,
			sources,
			targets,
			goals,
			track: base.track,
			via: base.via,
			trackStep: (z, cell, length) => {
				const next = z * cells + cell;
				return length * (1 + history[next]) + sharing(usageTrack, next);
			},
			viaStep: (cell) =>
				viaCost * (1 + history[cell] + history[cells + cell]) +
				sharing(usageVia, cell) +
				sharing(usageVia, cells + cell),
			skipSeenSources: true,
		}).path;

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
				stamp(route, state, viaOnTrack, usageVia, stampVia, route.marked.via);
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
	).ratsnest.filter((line) => wanted(line.net));
	return { shapes: output, failed: remaining };
}
