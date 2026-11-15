import {
	type BoardFootprint,
	type BoardPad,
	boardPads,
	footprintItems,
	isBoardFootprint,
} from "#/board/footprints.ts";
import {
	boundsOverlap,
	type Hull,
	hullBounds,
	hullDistance,
	lineEnds,
	shapeHulls,
} from "#/board/geometry.ts";
import type { BoardNetlist } from "#/board/netlist.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import { mergeBounds } from "#/drawing/shape-geometry.ts";
import type { Bounds, Point } from "#/drawing/types.ts";
import { copperLayers, isCopperLayer } from "#/footprint/layers.ts";
import { isPad, isVia, shapeLayer } from "#/footprint/shapes.ts";
import { unionFind } from "#/lib/union-find.ts";

export type CopperLayer = "F.Cu" | "B.Cu";
export type CopperKind = "pad" | "track" | "via" | "zone" | "graphic";

export interface CopperItem {
	index: number;
	/** The top-level board shape: the footprint for a pad. */
	shapeId: number;
	kind: CopperKind;
	pad?: BoardPad;
	shape: EditorShape;
	net?: string;
	layers: readonly CopperLayer[];
	hulls: readonly Hull[];
	bounds: Bounds;
	/** Points a ratsnest line may start or end at. */
	points: readonly Point[];
}

const touching = 1e-6;

export const isTrack = (shape: EditorShape) =>
	shape.kind === "line" && isCopperLayer(shape.layer);

export const isZone = (shape: EditorShape) =>
	shape.kind === "rectangle" && shape.zone !== undefined;

const itemCache = new WeakMap<
	readonly EditorShape[],
	{ netlist: BoardNetlist; items: CopperItem[] }
>();

export function copperItems(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
): CopperItem[] {
	const cached = itemCache.get(shapes);
	if (cached?.netlist === netlist) return cached.items;
	const items: CopperItem[] = [];
	const add = (item: Omit<CopperItem, "index" | "bounds">) => {
		if (!item.hulls.length) return;
		items.push({
			...item,
			index: items.length,
			bounds: mergeBounds(item.hulls.map(hullBounds)),
		});
	};
	for (const pad of boardPads(shapes)) {
		const layers: CopperLayer[] =
			pad.shape.pad.type === "through-hole"
				? ["F.Cu", "B.Cu"]
				: [shapeLayer(pad.shape) as CopperLayer];
		const net = netlist.padNet(pad.component, pad.number);
		add({
			shapeId: pad.footprint.id,
			kind: "pad",
			pad,
			shape: pad.shape,
			...(net ? { net } : {}),
			layers,
			hulls: shapeHulls(pad.shape),
			points: [{ x: pad.shape.x, y: pad.shape.y }],
		});
	}
	const padsOf = new Map<number, CopperItem[]>();
	for (const item of items) {
		const list = padsOf.get(item.shapeId);
		if (list) list.push(item);
		else padsOf.set(item.shapeId, [item]);
	}
	for (const shape of shapes) {
		if (isBoardFootprint(shape)) {
			const pads = padsOf.get(shape.id) ?? [];
			for (const child of footprintItems(shape as BoardFootprint)) {
				const part = child as EditorShape;
				if (isPad(part) || part.kind === "text") continue;
				if (isVia(part)) {
					const hulls = shapeHulls(part);
					const pad = pads.find((item) =>
						item.hulls.some((hull) =>
							hulls.some((own) => hullDistance(hull, own) <= touching),
						),
					);
					add({
						shapeId: shape.id,
						kind: "via",
						shape: part,
						...(pad?.net ? { net: pad.net } : {}),
						layers: copperLayers as CopperLayer[],
						hulls,
						points: [{ x: part.x, y: part.y }],
					});
				} else if (isCopperLayer(part.layer))
					add({
						shapeId: shape.id,
						kind: "graphic",
						shape: part,
						layers: [part.layer as CopperLayer],
						hulls: shapeHulls(part),
						points: [],
					});
			}
			continue;
		}
		if (isVia(shape)) {
			add({
				shapeId: shape.id,
				kind: "via",
				shape,
				...(shape.net ? { net: shape.net } : {}),
				layers: copperLayers as CopperLayer[],
				hulls: shapeHulls(shape),
				points: [{ x: shape.x, y: shape.y }],
			});
			continue;
		}
		if (!isCopperLayer(shape.layer) || shape.kind === "text") continue;
		const layer = shape.layer as CopperLayer;
		const kind: CopperKind = isTrack(shape)
			? "track"
			: isZone(shape)
				? "zone"
				: "graphic";
		const net =
			(shape.kind === "line" ||
				shape.kind === "rectangle" ||
				shape.kind === "circle" ||
				shape.kind === "triangle") &&
			shape.net
				? shape.net
				: undefined;
		add({
			shapeId: shape.id,
			kind,
			shape,
			...(net ? { net } : {}),
			layers: [layer],
			hulls: shapeHulls(shape),
			points:
				kind === "track"
					? lineEnds(shape)
					: kind === "zone"
						? []
						: [{ x: shape.x, y: shape.y }],
		});
	}
	itemCache.set(shapes, { netlist, items });
	return items;
}

export const sharesLayer = (a: CopperItem, b: CopperItem) =>
	a.layers.some((layer) => b.layers.includes(layer));

export function itemDistance(a: CopperItem, b: CopperItem): number {
	let distance = Infinity;
	for (const first of a.hulls)
		for (const second of b.hulls)
			distance = Math.min(distance, hullDistance(first, second));
	return distance;
}

/** Calls `visit` once for every pair of items whose bounds come within `margin`. */
export function nearbyPairs(
	items: readonly CopperItem[],
	margin: number,
	visit: (a: CopperItem, b: CopperItem) => void,
) {
	const cell = 2;
	const grid = new Map<string, number[]>();
	for (const item of items) {
		const { minX, minY, maxX, maxY } = item.bounds;
		for (
			let x = Math.floor((minX - margin) / cell);
			x <= Math.floor((maxX + margin) / cell);
			x++
		)
			for (
				let y = Math.floor((minY - margin) / cell);
				y <= Math.floor((maxY + margin) / cell);
				y++
			) {
				const key = `${x},${y}`;
				const bucket = grid.get(key);
				if (bucket) bucket.push(item.index);
				else grid.set(key, [item.index]);
			}
	}
	const seen = new Set<number>();
	const count = items.length;
	for (const bucket of grid.values())
		for (let i = 0; i < bucket.length; i++)
			for (let j = i + 1; j < bucket.length; j++) {
				const a = Math.min(bucket[i], bucket[j]);
				const b = Math.max(bucket[i], bucket[j]);
				const key = a * count + b;
				if (seen.has(key)) continue;
				seen.add(key);
				if (boundsOverlap(items[a].bounds, items[b].bounds, margin))
					visit(items[a], items[b]);
			}
}

export interface RatsnestLine {
	net: string;
	from: Point;
	to: Point;
}

export interface BoardConnectivity {
	items: readonly CopperItem[];
	/** The representative item of each item's connected group. */
	group: readonly number[];
	ratsnest: readonly RatsnestLine[];
}

export interface ZoneReach {
	islands(zone: CopperItem): number;
	/** @return The indices of the zone's islands that `item` touches. */
	touched(zone: CopperItem, item: CopperItem): readonly number[];
	/** @return The gap between a zone's copper and another item's. */
	gap?(a: CopperItem, b: CopperItem, within: number): number;
	/** @return Pairs of island indices of two zones that touch. */
	joined?(a: CopperItem, b: CopperItem): readonly (readonly [number, number])[];
}

const defaultZoneReach: ZoneReach = {
	islands: () => 1,
	touched: (zone, item) => (itemDistance(zone, item) <= touching ? [0] : []),
};

/**
 * Groups copper on the same net that touches on a shared layer, then joins
 * the groups of each net with the shortest lines that connect them all.
 */
export function analyzeConnectivity(
	items: readonly CopperItem[],
	zoneReach: ZoneReach = defaultZoneReach,
): BoardConnectivity {
	const islandBase = new Map<number, number>();
	let nodes = items.length;
	for (const item of items)
		if (item.kind === "zone") {
			islandBase.set(item.index, nodes);
			nodes += zoneReach.islands(item);
		}
	const sets = unionFind(nodes);
	nearbyPairs(items, touching, (a, b) => {
		if (!a.net || a.net !== b.net || !sharesLayer(a, b)) return;
		if (a.kind === "zone" && b.kind === "zone") {
			const first = islandBase.get(a.index) ?? 0;
			const second = islandBase.get(b.index) ?? 0;
			for (const [i, j] of zoneReach.joined?.(a, b) ?? [])
				sets.union(first + i, second + j);
			return;
		}
		if (a.kind === "zone" || b.kind === "zone") {
			const [zone, other] = a.kind === "zone" ? [a, b] : [b, a];
			const base = islandBase.get(zone.index) ?? 0;
			for (const island of zoneReach.touched(zone, other))
				sets.union(other.index, base + island);
			return;
		}
		if (itemDistance(a, b) > touching) return;
		sets.union(b.index, a.index);
	});
	const group = items.map((item) => sets.find(item.index));
	const byNet = new Map<string, Map<number, Point[]>>();
	for (const item of items) {
		if (!item.net || !item.points.length) continue;
		let groups = byNet.get(item.net);
		if (!groups) {
			groups = new Map();
			byNet.set(item.net, groups);
		}
		const root = group[item.index];
		const points = groups.get(root);
		if (points) points.push(...item.points);
		else groups.set(root, [...item.points]);
	}
	const ratsnest: RatsnestLine[] = [];
	for (const [net, groups] of byNet) {
		const clusters = [...groups.values()];
		if (clusters.length < 2) continue;
		ratsnest.push(...spanningLines(net, clusters));
	}
	return { items, group, ratsnest };
}

function closest(a: readonly Point[], b: readonly Point[]) {
	let best = { distance: Infinity, from: a[0], to: b[0] };
	for (const p of a)
		for (const q of b) {
			const distance = Math.hypot(p.x - q.x, p.y - q.y);
			if (distance < best.distance) best = { distance, from: p, to: q };
		}
	return best;
}

function spanningLines(net: string, clusters: Point[][]): RatsnestLine[] {
	const joined = new Set([0]);
	const best = clusters.map((cluster) => closest(clusters[0], cluster));
	const lines: RatsnestLine[] = [];
	while (joined.size < clusters.length) {
		let next = -1;
		for (let index = 0; index < clusters.length; index++)
			if (
				!joined.has(index) &&
				(next < 0 || best[index].distance < best[next].distance)
			)
				next = index;
		const link = best[next];
		lines.push({ net, from: link.from, to: link.to });
		joined.add(next);
		for (let index = 0; index < clusters.length; index++) {
			if (joined.has(index)) continue;
			const candidate = closest(clusters[next], clusters[index]);
			if (candidate.distance < best[index].distance) best[index] = candidate;
		}
	}
	return lines;
}

/** The copper item under a point on the given layer, preferring pads and vias. */
export function copperAt(
	items: readonly CopperItem[],
	point: Point,
	layer: CopperLayer | undefined,
	tolerance: number,
): CopperItem | undefined {
	const probe: Hull = { points: [point], radius: tolerance };
	let found: CopperItem | undefined;
	const rank = (item: CopperItem) =>
		item.kind === "pad" || item.kind === "via"
			? 0
			: item.kind === "track"
				? 1
				: 2;
	for (const item of items) {
		if (layer && !item.layers.includes(layer)) continue;
		if (
			!boundsOverlap(
				item.bounds,
				{ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y },
				tolerance,
			)
		)
			continue;
		if (!item.hulls.some((hull) => hullDistance(hull, probe) <= 0)) continue;
		if (!found || rank(item) < rank(found)) found = item;
	}
	return found;
}
