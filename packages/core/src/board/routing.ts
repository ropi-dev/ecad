import {
	type CopperItem,
	type CopperLayer,
	copperAt,
} from "@ecad/drawing-core/board/connectivity.ts";
import {
	boundsOverlap,
	lineEnds,
	pointHullDistance,
	trackSegment,
} from "@ecad/drawing-core/board/geometry.ts";
import type { LineShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";

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

export function trackSegments(
	firstId: number,
	points: readonly Point[],
	layer: CopperLayer,
	width: number,
	net: string | undefined,
): LineShape[] {
	const segments: LineShape[] = [];
	for (let index = 1; index < points.length; index++) {
		const from = points[index - 1];
		const to = points[index];
		if (Math.hypot(to.x - from.x, to.y - from.y) < 1e-6) continue;
		segments.push(
			trackSegment(firstId + segments.length, from, to, layer, width, net),
		);
	}
	return segments;
}

interface RouteAnchor {
	point: Point;
	item: CopperItem;
}

/**
 * Where a track starts or ends on existing copper: the centre of a pad or
 * via, the nearer end of a track when the point is close to it, or the
 * nearest point on the track's centre line.
 */
export function routeAnchor(
	items: readonly CopperItem[],
	point: Point,
	layer: CopperLayer | undefined,
	tolerance: number,
): RouteAnchor | undefined {
	const item = copperAt(items, point, layer, tolerance);
	if (!item || item.kind === "zone" || item.kind === "graphic")
		return undefined;
	if (item.kind !== "track" || item.shape.kind !== "line")
		return { point: { x: item.shape.x, y: item.shape.y }, item };
	const [a, b] = lineEnds(item.shape);
	const reach = Math.max(item.shape.lineWidth, tolerance * 2);
	for (const end of [a, b])
		if (Math.hypot(end.x - point.x, end.y - point.y) <= reach)
			return { point: end, item };
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const length = dx * dx + dy * dy || 1;
	const t = Math.max(
		0,
		Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
	);
	return { point: { x: a.x + t * dx, y: a.y + t * dy }, item };
}

export function trackAnchor(
	items: readonly CopperItem[],
	point: Point,
	{
		layer,
		net,
		exclude,
		padReach,
		tolerance,
	}: {
		layer?: CopperLayer;
		net?: string;
		exclude?: Point;
		padReach: number;
		tolerance: number;
	},
): RouteAnchor | undefined {
	const joins = (item: CopperItem) =>
		net === undefined || item.net === undefined || item.net === net;
	const area = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
	let best: { anchor: RouteAnchor; gap: number; distance: number } | undefined;
	for (const item of items) {
		if (item.kind !== "pad" && item.kind !== "via") continue;
		if (layer && !item.layers.includes(layer)) continue;
		if (!joins(item) || !boundsOverlap(item.bounds, area, padReach)) continue;
		const centre = { x: item.shape.x, y: item.shape.y };
		if (
			exclude &&
			Math.hypot(centre.x - exclude.x, centre.y - exclude.y) < 1e-6
		)
			continue;
		const gap = Math.max(
			0,
			Math.min(...item.hulls.map((hull) => pointHullDistance(hull, point))),
		);
		if (gap > padReach) continue;
		const distance = Math.hypot(centre.x - point.x, centre.y - point.y);
		if (
			!best ||
			gap < best.gap ||
			(gap === best.gap && distance < best.distance)
		)
			best = { anchor: { point: centre, item }, gap, distance };
	}
	if (best) return best.anchor;
	const anchor = routeAnchor(items, point, layer, tolerance);
	return anchor && joins(anchor.item) ? anchor : undefined;
}

export const otherCopperLayer = (layer: CopperLayer): CopperLayer =>
	layer === "F.Cu" ? "B.Cu" : "F.Cu";
