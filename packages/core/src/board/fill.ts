import {
	type CopperItem,
	type CopperLayer,
	copperItems,
	itemDistance,
	type ZoneReach,
} from "@ecad/drawing-core/board/connectivity.ts";
import { boardOutlineSegments } from "@ecad/drawing-core/board/drc.ts";
import {
	boundsOverlap,
	hullPolygon,
	rectangleCorners,
} from "@ecad/drawing-core/board/geometry.ts";
import type { BoardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import type { BoardRules } from "@ecad/drawing-core/board/rules.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	combinePolygons,
	containsPoint,
	type MultiPolygon,
} from "#/engine/geometry.ts";

export interface ZoneFill {
	zone: CopperItem;
	layer: CopperLayer;
	net?: string;
	/** Copper islands that touch an item on the zone's net. */
	polygons: MultiPolygon;
}

type Ring = [number, number][];
const ring = (points: readonly Point[]): Ring =>
	points.map((point) => [point.x, point.y]);
const arc = Math.PI / 16;

/** Closed loops chained from outline segments whose ends meet. */
export function outlineLoops(
	segments: readonly (readonly [Point, Point])[],
): Point[][] {
	const key = (point: Point) =>
		`${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`;
	const unused = new Set(segments.map((_, index) => index));
	const loops: Point[][] = [];
	while (unused.size) {
		const first = unused.values().next().value as number;
		unused.delete(first);
		const loop = [segments[first][0], segments[first][1]];
		let closed = false;
		for (let guard = 0; guard < segments.length; guard++) {
			const end = key(loop[loop.length - 1]);
			if (end === key(loop[0])) {
				closed = true;
				break;
			}
			let next = -1;
			let reversed = false;
			for (const index of unused) {
				if (key(segments[index][0]) === end) {
					next = index;
					break;
				}
				if (key(segments[index][1]) === end) {
					next = index;
					reversed = true;
					break;
				}
			}
			if (next < 0) break;
			unused.delete(next);
			loop.push(segments[next][reversed ? 0 : 1]);
		}
		if (closed && loop.length > 3) loops.push(loop.slice(0, -1));
	}
	return loops;
}

function boardInterior(
	shapes: readonly EditorShape[],
): MultiPolygon | undefined {
	const loops = outlineLoops(boardOutlineSegments(shapes));
	if (!loops.length) return undefined;
	// Even-odd: an outline inside another one cuts a hole.
	let interior: MultiPolygon = [];
	for (const loop of loops) {
		const polygon: MultiPolygon = [[ring(loop)]];
		interior = interior.length
			? containsPoint(interior, loop[0])
				? combinePolygons(interior, polygon, true)
				: combinePolygons(interior, polygon)
			: combinePolygons(polygon);
	}
	return interior;
}

const fillCache = new WeakMap<
	readonly EditorShape[],
	{ netlist: BoardNetlist; rules: BoardRules; fills: ZoneFill[] }
>();

function touchesFill(polygons: MultiPolygon, item: CopperItem): boolean {
	for (const hull of item.hulls) {
		for (const point of hull.points)
			if (containsPoint(polygons, point, hull.radius)) return true;
		const outline = hullPolygon(hull, 0, Math.PI / 4);
		if (outline.some((point) => containsPoint(polygons, point))) return true;
	}
	return false;
}

/**
 * Fills each zone: its rectangle inside the board outline, less the edge
 * clearance and the copper of other nets grown by the clearance. Islands
 * that reach nothing on the zone's net are removed.
 */
export function fillZones(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	rules: BoardRules,
): ZoneFill[] {
	const cached = fillCache.get(shapes);
	if (cached?.netlist === netlist && cached.rules === rules)
		return cached.fills;
	const items = copperItems(shapes, netlist);
	const zones = items.filter((item) => item.kind === "zone");
	const fills: ZoneFill[] = [];
	if (zones.length) {
		const interior = boardInterior(shapes);
		const edges = boardOutlineSegments(shapes).map((segment) => [
			ring(
				hullPolygon({ points: segment, radius: 0 }, rules.edgeClearance, arc),
			),
		]);
		for (const zone of zones) {
			const layer = zone.layers[0];
			const clearance =
				(zone.shape.kind === "rectangle" && zone.shape.zone?.clearance) ||
				rules.clearance;
			let region: MultiPolygon = combinePolygons([
				[ring(rectangleCorners(zone.shape))],
			]);
			if (interior)
				region = combinePolygons(
					region,
					combinePolygons(region, interior, true),
					true,
				);
			const obstacles: MultiPolygon = [...edges];
			for (const item of items) {
				if (item === zone || !item.layers.includes(layer)) continue;
				if (item.kind === "zone") continue;
				if (!boundsOverlap(item.bounds, zone.bounds, clearance)) continue;
				if (zone.net !== undefined && item.net === zone.net) continue;
				for (const hull of item.hulls)
					obstacles.push([ring(hullPolygon(hull, clearance, arc))]);
			}
			for (
				let start = 0;
				start < obstacles.length && region.length;
				start += 64
			)
				region = combinePolygons(
					region,
					combinePolygons(obstacles.slice(start, start + 64)),
					true,
				);
			const members = items.filter(
				(item) =>
					item !== zone &&
					item.kind !== "zone" &&
					zone.net !== undefined &&
					item.net === zone.net &&
					item.layers.includes(layer) &&
					boundsOverlap(item.bounds, zone.bounds),
			);
			const polygons = region.filter((polygon) =>
				members.some((item) => touchesFill([polygon], item)),
			);
			fills.push({
				zone,
				layer,
				...(zone.net ? { net: zone.net } : {}),
				polygons,
			});
		}
	}
	fillCache.set(shapes, { netlist, rules, fills });
	return fills;
}

/** Zone connectivity that follows the computed fill, islands removed. */
export function fillReach(fills: readonly ZoneFill[]): ZoneReach {
	const byZone = new Map(fills.map((fill) => [fill.zone.index, fill]));
	return (zone, item) => {
		const fill = byZone.get(zone.index);
		if (!fill) return itemDistance(zone, item) <= 1e-6;
		return touchesFill(fill.polygons, item);
	};
}
