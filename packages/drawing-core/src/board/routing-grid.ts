import {
	type CopperItem,
	type CopperLayer,
	copperItems,
	type RatsnestLine,
} from "#/board/connectivity.ts";
import {
	boardOutlineSegments,
	insideOutline,
	outlineBounds,
} from "#/board/drc.ts";
import {
	type Hull,
	pointHullDistance,
	trackSegment,
} from "#/board/geometry.ts";
import type { BoardNetlist } from "#/board/netlist.ts";
import type { BoardRules } from "#/board/rules.ts";
import type { EditorShape, FillableShape } from "#/drawing/schema.ts";
import type { Point } from "#/drawing/types.ts";

export const layers: readonly CopperLayer[] = ["F.Cu", "B.Cu"];
export const free = -1;
const blocked = -2;
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
export const pitch = 0.1;
export const viaCost = 1.5;
const bendCost = pitch * 2;

export const ruleVia = (
	id: number,
	at: Point,
	rules: BoardRules,
	net?: string,
): FillableShape => ({
	id,
	kind: "circle",
	layer: "F.Cu",
	x: at.x,
	y: at.y,
	width: rules.viaDiameter,
	height: rules.viaDiameter,
	rotation: 0,
	lineWidth: 0.15,
	filled: true,
	via: {
		drill:
			rules.viaDrill < rules.viaDiameter
				? rules.viaDrill
				: rules.viaDiameter * 0.6,
	},
	...(net ? { net } : {}),
});

const open = (grid: Int32Array, cell: number, owner: number) =>
	grid[cell] === free || grid[cell] === owner;

class Heap {
	private keys = new Float64Array(1024);
	private values = new Int32Array(1024);
	private length = 0;
	get size() {
		return this.length;
	}
	push(value: number, key: number) {
		if (this.length === this.keys.length) {
			const keys = new Float64Array(this.length * 2);
			const values = new Int32Array(this.length * 2);
			keys.set(this.keys);
			values.set(this.values);
			this.keys = keys;
			this.values = values;
		}
		const { keys, values } = this;
		let index = this.length++;
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
		const last = --this.length;
		const lastKey = keys[last];
		const lastValue = values[last];
		if (last) {
			let index = 0;
			for (;;) {
				const left = 2 * index + 1;
				if (left >= last) break;
				const right = left + 1;
				const child = right < last && keys[right] < keys[left] ? right : left;
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

interface GridTarget {
	track: Int32Array[];
	via: Int32Array[];
}

export interface RoutingResult {
	/** New tracks and vias, with IDs from `nextId` upwards. */
	shapes: EditorShape[];
	/** Connections no route was found for. */
	failed: RatsnestLine[];
}

interface SearchRequest {
	owner: number;
	sources: readonly number[];
	targets: { has(state: number): boolean };
	goals: readonly Point[];
	track: readonly Int32Array[];
	via: readonly Int32Array[];
	trackStep(z: number, cell: number, length: number): number;
	viaStep(cell: number): number;
	limit?: number;
	skipSeenSources?: boolean;
}

export function routingGrid(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	rules: BoardRules,
) {
	const width = rules.trackWidth;
	const viaRadius = rules.viaDiameter / 2;
	const margin = pitch * 0.25;
	const outline = boardOutlineSegments(shapes);
	const bounds = outlineBounds(outline);
	if (!bounds) return undefined;
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
	const base: GridTarget = { track: grids(), via: grids() };
	const near = grids();
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
		target: GridTarget,
		pad = false,
		reached?: (cell: number) => void,
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
		const point = { x: 0, y: 0 };
		for (let row = firstRow; row <= lastRow; row++)
			for (let column = firstColumn; column <= lastColumn; column++) {
				point.x = originX + column * pitch;
				point.y = originY + row * pitch;
				const distance = pointHullDistance(hull, point);
				if (distance >= reach) continue;
				const cell = row * columns + column;
				if (pad && distance < nearReach) claim(near[layer], cell, owner);
				if (distance < reachTrack) claim(target.track[layer], cell, owner);
				if (distance < reachVia) {
					claim(target.via[layer], cell, owner);
					reached?.(cell);
				}
			}
	};
	const items = copperItems(shapes, netlist);
	for (const item of items) {
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
	const edgeTrack = rules.edgeClearance + width / 2;
	const edgeVia = rules.edgeClearance + viaRadius;
	for (let cell = 0; cell < cells; cell++) {
		const point = center(cell);
		let edge = Infinity;
		for (const [a, b] of outline)
			edge = Math.min(
				edge,
				pointHullDistance({ points: [a, b], radius: 0 }, point),
			);
		const inside = insideOutline(point, outline);
		for (let layer = 0; layer < layers.length; layer++) {
			if (!inside || edge < edgeTrack) base.track[layer][cell] = blocked;
			if (!inside || edge < edgeVia) base.via[layer][cell] = blocked;
		}
	}
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
					if (item.hulls.some((hull) => pointHullDistance(hull, point) <= 1e-9))
						result.push(z * cells + cell);
				}
		}
		return result;
	};
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
					trackSegment(
						0,
						corners[index - 1],
						corners[index],
						layers[runLayer],
						width,
						net,
					),
				);
		};
		for (const state of path) {
			const z = Math.floor(state / cells);
			const point = center(state % cells);
			if (z !== runLayer) {
				flush();
				result.push(ruleVia(0, point, rules, net));
				run = [];
				runLayer = z;
			}
			run.push(point);
		}
		flush();
		return result;
	};
	const states = cells * layers.length;
	const cost = new Float32Array(states);
	const parent = new Int32Array(states);
	const heading = new Int8Array(states);
	const closed = new Uint8Array(states);
	const visited: number[] = [];
	const search = (request: SearchRequest) => {
		const { owner, goals, track, via } = request;
		for (const state of visited) {
			cost[state] = 0;
			parent[state] = 0;
			heading[state] = 0;
			closed[state] = 0;
		}
		visited.length = 0;
		const heap = new Heap();
		const goalXs = goals.map((goal) => goal.x);
		const goalYs = goals.map((goal) => goal.y);
		const estimate = (cell: number) => {
			const x = originX + (cell % columns) * pitch;
			const y = originY + Math.floor(cell / columns) * pitch;
			let best = Infinity;
			for (let index = 0; index < goalXs.length; index++) {
				const dx = Math.abs(x - goalXs[index]);
				const dy = Math.abs(y - goalYs[index]);
				const distance =
					dx > dy ? dx + (Math.SQRT2 - 1) * dy : dy + (Math.SQRT2 - 1) * dx;
				if (distance < best) best = distance;
			}
			return best;
		};
		for (const state of request.sources) {
			if (!open(track[Math.floor(state / cells)], state % cells, owner))
				continue;
			if (request.skipSeenSources && cost[state]) continue;
			cost[state] = 1e-6;
			parent[state] = -1;
			heading[state] = 8;
			visited.push(state);
			heap.push(state, estimate(state % cells));
		}
		const limit = request.limit ?? Infinity;
		let steps = 0;
		let state = 0;
		let reached = 0;
		let from = 0;
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
		while (heap.size && steps < limit) {
			state = heap.pop();
			if (closed[state]) continue;
			closed[state] = 1;
			steps++;
			if (request.targets.has(state)) {
				const path: number[] = [];
				for (let at = state; at >= 0; at = parent[at]) path.push(at);
				return { path: path.reverse(), steps, queue: heap.size };
			}
			const z = Math.floor(state / cells);
			const cell = state % cells;
			const column = cell % columns;
			const row = Math.floor(cell / columns);
			reached = cost[state];
			from = heading[state];
			const layer = track[z];
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
				if (!open(layer, nextCell, owner)) continue;
				if (
					dx &&
					dy &&
					(!open(layer, row * columns + nextColumn, owner) ||
						!open(layer, nextRow * columns + column, owner))
				)
					continue;
				const nearby = near[z][nextCell];
				const length =
					(dx && dy ? pitch * Math.SQRT2 : pitch) +
					(nearby !== free && nearby !== owner ? pitch * 8 : 0);
				relax(
					z * cells + nextCell,
					request.trackStep(z, nextCell, length),
					direction,
				);
			}
			const other = 1 - z;
			if (
				open(via[0], cell, owner) &&
				open(via[1], cell, owner) &&
				open(track[other], cell, owner)
			)
				relax(other * cells + cell, request.viaStep(cell), 8);
		}
		return { path: undefined, steps, queue: heap.size };
	};
	return {
		items,
		columns,
		rows,
		cells,
		width,
		viaRadius,
		margin,
		base,
		grids,
		indexOf,
		mark,
		cellsInside,
		pathShapes,
		search,
	};
}
