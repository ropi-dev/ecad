import {
	analyzeConnectivity,
	type CopperItem,
	type CopperLayer,
	copperItems,
	type RatsnestLine,
	type ZoneReach,
} from "#/board/connectivity.ts";
import { hullDistance, lineEnds } from "#/board/geometry.ts";
import type { BoardNetlist } from "#/board/netlist.ts";
import {
	free,
	layers,
	type RoutingResult,
	routingGrid,
	viaCost,
} from "#/board/routing-grid.ts";
import type { BoardRules } from "#/board/rules.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import type { Point } from "#/drawing/types.ts";

export interface AutorouteOptions {
	rules: BoardRules;
	zoneReach?: ZoneReach;
	rippable?: readonly EditorShape[];
	/** Called with what happened to each connection, for diagnosis. */
	trace?: (event: string, line: RatsnestLine) => void;
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
const atPoint = (point: Point, item: CopperItem) =>
	item.points.some(
		(candidate) =>
			Math.abs(candidate.x - point.x) < 1e-9 &&
			Math.abs(candidate.y - point.y) < 1e-9,
	);

export function autoroute(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	nextId: number,
	options: AutorouteOptions,
): RoutingResult {
	const { rules } = options;
	const grid = routingGrid(shapes, netlist, rules);
	if (!grid) return { shapes: [], failed: [] };
	const {
		cells,
		width,
		viaRadius,
		base,
		indexOf,
		mark,
		cellsInside,
		pathShapes,
	} = grid;
	const trackGrid = grid.grids();
	const viaGrid = grid.grids();
	const routeGrid = grid.grids();

	const routes: Route[] = [];
	if (options.rippable?.length) {
		const items = copperItems(options.rippable, netlist);
		const { group } = analyzeConnectivity(items);
		const chains = new Map<number, Route>();
		for (const item of items) {
			if (!item.net) continue;
			let route = chains.get(group[item.index]);
			if (!route) {
				route = {
					net: item.net,
					owner: indexOf(item.net),
					shapes: [],
					alive: true,
				};
				chains.set(group[item.index], route);
				routes.push(route);
			}
			route.shapes.push(item.shape);
		}
	}
	const routeHulls = (shapes: readonly EditorShape[]) =>
		shapes.flatMap((shape) =>
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
			trackGrid[layer].set(base.track[layer]);
			viaGrid[layer].set(base.via[layer]);
			routeGrid[layer].fill(free);
		}
		routes.forEach((route, index) => {
			if (!route.alive) return;
			for (const { layers: on, hull } of routeHulls(route.shapes))
				for (const layer of on)
					mark(hull, layer, route.owner, live, false, (cell) => {
						routeGrid[layer][cell] = index;
					});
		});
	};

	const budget = 2 * cells * layers.length;
	const strictBudget = 150_000;
	const ripCost = 3;
	const ripped = new Map<number, number>();
	let lastSteps = 0;
	let lastQueue = 0;
	const search = (
		owner: number,
		sources: readonly number[],
		targets: ReadonlySet<number>,
		goal: Point,
		crossing: boolean,
	): number[] | undefined => {
		const penalty = (z: number, cell: number) => {
			if (!crossing) return 0;
			const route = routeGrid[z][cell];
			if (route === free) return 0;
			const other = routes[route];
			if (!other?.alive || other.owner === owner) return 0;
			return ripCost * (1 + (ripped.get(other.owner) ?? 0));
		};
		const result = grid.search({
			owner,
			sources,
			targets,
			goals: [goal],
			track: crossing ? base.track : trackGrid,
			via: crossing ? base.via : viaGrid,
			trackStep: (z, cell, length) => length + penalty(z, cell),
			viaStep: (cell) => viaCost + penalty(0, cell) + penalty(1, cell),
			limit: crossing ? budget : Math.min(budget, strictBudget),
		});
		lastSteps = result.steps;
		lastQueue = result.queue;
		return result.path;
	};

	const crossedRoutes = (added: readonly EditorShape[], owner: number) => {
		const mine = routeHulls(added);
		const crossed = new Set<number>();
		routes.forEach((route, index) => {
			if (!route.alive || route.owner === owner) return;
			for (const theirs of routeHulls(route.shapes))
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
	const key = (line: RatsnestLine) =>
		`${line.net}:${line.from.x},${line.from.y}:${line.to.x},${line.to.y}`;
	for (let iteration = 0; iteration < 1500; iteration++) {
		const current = [
			...shapes,
			...routes.flatMap((route) => (route.alive ? route.shapes : [])),
		];
		const items = copperItems(current, netlist);
		const connectivity = analyzeConnectivity(items, options.zoneReach);
		const pending = connectivity.ratsnest
			.filter((line) => !given.has(key(line)))
			.sort(
				(a, b) =>
					(attempts.get(key(b)) ?? 0) - (attempts.get(key(a)) ?? 0) ||
					Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) -
						Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y),
			);
		const line = pending[0];
		if (!line) break;
		const tries = (attempts.get(key(line)) ?? 0) + 1;
		attempts.set(key(line), tries);
		const sourceItem = items.find(
			(item) => item.net === line.net && atPoint(line.from, item),
		);
		const targetItem = items.find(
			(item) => item.net === line.net && atPoint(line.to, item),
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
	return {
		shapes: output,
		failed: [...analyzeConnectivity(finalItems, options.zoneReach).ratsnest],
	};
}
