import earcut from "earcut";
import type { EditorShape, LineShape } from "#/drawing/schema.ts";
import type { Bounds, Point } from "#/drawing/types.ts";
import { isPolygonZone, zoneOutlinePoints } from "#/drawing/zone-outline.ts";
import type { CopperLayer } from "#/footprint/layers.ts";
import { padCornerRadius } from "#/footprint/shapes.ts";

/**
 * A convex outline grown by `radius`: one point is a disc, two points a
 * stadium, three or more a polygon with rounded corners. Points go
 * counterclockwise.
 */
export interface Hull {
	points: readonly Point[];
	radius: number;
}

export function hullBounds(hull: Hull): Bounds {
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
	return {
		minX: minX - hull.radius,
		minY: minY - hull.radius,
		maxX: maxX + hull.radius,
		maxY: maxY + hull.radius,
	};
}

export const boundsOverlap = (a: Bounds, b: Bounds, margin = 0) =>
	a.minX <= b.maxX + margin &&
	b.minX <= a.maxX + margin &&
	a.minY <= b.maxY + margin &&
	b.minY <= a.maxY + margin;

const rotate = (shape: EditorShape, x: number, y: number): Point => {
	const cos = Math.cos(shape.rotation);
	const sin = Math.sin(shape.rotation);
	return { x: shape.x + x * cos - y * sin, y: shape.y + x * sin + y * cos };
};

export function lineEnds(shape: EditorShape): [Point, Point] {
	return [
		rotate(shape, -shape.width / 2, 0),
		rotate(shape, shape.width / 2, 0),
	];
}

export function rectangleCorners(shape: EditorShape, inset = 0): Point[] {
	const w = shape.width / 2 - inset;
	const h = shape.height / 2 - inset;
	return [
		rotate(shape, -w, -h),
		rotate(shape, w, -h),
		rotate(shape, w, h),
		rotate(shape, -w, h),
	];
}

/**
 * A rounded rectangle is its rectangle shrunk by the corner radius and grown
 * back by it. A side that shrinks to nothing leaves a stadium or a disc.
 */
function roundedRectangleHull(shape: EditorShape, radius: number): Hull {
	const w = shape.width / 2 - radius;
	const h = shape.height / 2 - radius;
	const flat = 1e-6;
	if (w <= flat && h <= flat) return { points: [rotate(shape, 0, 0)], radius };
	if (w <= flat)
		return { points: [rotate(shape, 0, -h), rotate(shape, 0, h)], radius };
	if (h <= flat)
		return { points: [rotate(shape, -w, 0), rotate(shape, w, 0)], radius };
	return { points: rectangleCorners(shape, radius), radius };
}

/** @return The corners of a zone's area: its polygon, or its rectangle. */
export const zoneCorners = (shape: EditorShape): Point[] =>
	isPolygonZone(shape) ? zoneOutlinePoints(shape) : rectangleCorners(shape);

/**
 * Whether two edges of a closed outline that are not neighbours cross, or
 * also touch unless `properly` is set.
 */
export function selfCrossing(
	points: readonly Point[],
	properly = false,
): boolean {
	const count = points.length;
	const edges = points.map((point, index) => {
		const next = points[(index + 1) % count];
		return {
			minX: Math.min(point.x, next.x),
			minY: Math.min(point.y, next.y),
			maxX: Math.max(point.x, next.x),
			maxY: Math.max(point.y, next.y),
		};
	});
	for (let first = 0; first < count; first++)
		for (let second = first + 2; second < count; second++) {
			if (first === 0 && second === count - 1) continue;
			if (!boundsOverlap(edges[first], edges[second], 1e-9)) continue;
			const a = points[first];
			const b = points[(first + 1) % count];
			const c = points[second];
			const d = points[(second + 1) % count];
			if (
				properly
					? segmentsIntersect(a, b, c, d)
					: segmentDistance(a, b, c, d) < 1e-9
			)
				return true;
		}
	return false;
}

/**
 * Whether corners drawn so far make a zone: three or more that enclose at
 * least `minimumArea`, or whose edges properly cross over a box of that area,
 * since crossing lobes cancel in the signed area.
 */
export function outlineEncloses(
	points: readonly Point[],
	minimumArea: number,
): boolean {
	if (points.length < 3) return false;
	const area =
		Math.abs(
			points.reduce((sum, point, index) => {
				const next = points[(index + 1) % points.length];
				return sum + point.x * next.y - next.x * point.y;
			}, 0),
		) / 2;
	if (area >= minimumArea) return true;
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const box =
		(Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
	return box >= minimumArea && selfCrossing(points, true);
}

const edgeHulls = (points: readonly Point[]): Hull[] =>
	points.map((point, index) => ({
		points: [point, points[(index + 1) % points.length]],
		radius: 0,
	}));

/**
 * Triangles covering a simple polygon. A self-crossing outline keeps only its
 * edges, since triangulating it can claim area the even-odd fill leaves empty.
 */
function polygonHulls(corners: readonly Point[]): Hull[] {
	const points = corners.filter((point, index) => {
		const previous = corners[(index + corners.length - 1) % corners.length];
		return (
			Math.abs(point.x - previous.x) > 1e-9 ||
			Math.abs(point.y - previous.y) > 1e-9
		);
	});
	if (points.length < 3 || selfCrossing(points)) return edgeHulls(corners);
	const indices = earcut(points.flatMap((point) => [point.x, point.y]));
	const hulls: Hull[] = [];
	for (let index = 0; index < indices.length; index += 3) {
		const a = points[indices[index]];
		const b = points[indices[index + 1]];
		const c = points[indices[index + 2]];
		const turn = cross(a, b, c);
		if (Math.abs(turn) > 1e-12)
			hulls.push({ points: turn > 0 ? [a, b, c] : [a, c, b], radius: 0 });
	}
	return hulls.length ? hulls : edgeHulls(points);
}

/** The copper a board shape covers, in board coordinates. */
export function shapeHulls(shape: EditorShape): Hull[] {
	if (shape.kind === "line" || shape.kind === "wire")
		return [{ points: lineEnds(shape), radius: shape.lineWidth / 2 }];
	if (shape.kind === "circle") {
		const solid =
			shape.filled ||
			shape.pad !== undefined ||
			shape.via !== undefined ||
			shape.hole !== undefined;
		return [
			{
				points: [{ x: shape.x, y: shape.y }],
				radius: shape.width / 2 + (solid ? 0 : shape.lineWidth / 2),
			},
		];
	}
	if (isPolygonZone(shape)) return polygonHulls(zoneOutlinePoints(shape));
	if (shape.kind === "rectangle") {
		const radius = padCornerRadius(shape);
		if (radius > 0) return [roundedRectangleHull(shape, radius)];
		const corners = rectangleCorners(shape);
		if (shape.filled || shape.pad || shape.zone)
			return [{ points: corners, radius: 0 }];
		return corners.map((corner, index) => ({
			points: [corner, corners[(index + 1) % 4]],
			radius: shape.lineWidth / 2,
		}));
	}
	if (shape.kind === "triangle") {
		const w = shape.width / 2;
		const h = shape.height / 2;
		const corners = [
			rotate(shape, -w, -h),
			rotate(shape, w, -h),
			rotate(shape, 0, h),
		];
		if (shape.filled) return [{ points: corners, radius: 0 }];
		return corners.map((corner, index) => ({
			points: [corner, corners[(index + 1) % 3]],
			radius: shape.lineWidth / 2,
		}));
	}
	return [];
}

const cross = (o: Point, a: Point, b: Point) =>
	(a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const length = dx * dx + dy * dy;
	const t = length
		? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
		: 0;
	return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
	const d1 = cross(c, d, a);
	const d2 = cross(c, d, b);
	const d3 = cross(a, b, c);
	const d4 = cross(a, b, d);
	return (
		((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
		((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
	);
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
	if (segmentsIntersect(a, b, c, d)) return 0;
	return Math.min(
		pointSegmentDistance(a, c, d),
		pointSegmentDistance(b, c, d),
		pointSegmentDistance(c, a, b),
		pointSegmentDistance(d, a, b),
	);
}

/** Whether a point is inside a convex polygon, in either winding. */
function insidePolygon(point: Point, polygon: readonly Point[]): boolean {
	if (polygon.length < 3) return false;
	let sign = 0;
	for (let index = 0; index < polygon.length; index++) {
		const side = cross(
			polygon[index],
			polygon[(index + 1) % polygon.length],
			point,
		);
		if (Math.abs(side) < 1e-12) continue;
		if (!sign) sign = Math.sign(side);
		else if (Math.sign(side) !== sign) return false;
	}
	return true;
}

function edges(points: readonly Point[]): [Point, Point][] {
	if (points.length === 1) return [[points[0], points[0]]];
	if (points.length === 2) return [[points[0], points[1]]];
	return points.map((point, index) => [
		point,
		points[(index + 1) % points.length],
	]);
}

function coreDistance(a: readonly Point[], b: readonly Point[]): number {
	if (a.some((point) => insidePolygon(point, b))) return 0;
	if (b.some((point) => insidePolygon(point, a))) return 0;
	let distance = Infinity;
	for (const [p, q] of edges(a))
		for (const [r, s] of edges(b)) {
			distance = Math.min(distance, segmentDistance(p, q, r, s));
			if (distance === 0) return 0;
		}
	return distance;
}

/** Gap between two hulls, or a negative overlap depth when they overlap. */
export function hullDistance(a: Hull, b: Hull): number {
	return coreDistance(a.points, b.points) - a.radius - b.radius;
}

export function pointHullDistance(hull: Hull, point: Point): number {
	const { points } = hull;
	if (points.length >= 3 && insidePolygon(point, points)) return -hull.radius;
	let distance = Infinity;
	const count = points.length === 2 ? 1 : points.length;
	for (let index = 0; index < count; index++) {
		const a = points[index];
		const b = points.length === 1 ? a : points[(index + 1) % points.length];
		distance = Math.min(distance, pointSegmentDistance(point, a, b));
		if (distance === 0) return -hull.radius;
	}
	return distance - hull.radius;
}

/**
 * The hull's outline as a closed polygon, grown by `margin`, or shrunk when
 * `margin` is negative. Rounded parts use about one segment per `step`
 * radians. A hull that shrinks away has no outline.
 */
export function hullPolygon(
	hull: Hull,
	margin = 0,
	step = Math.PI / 12,
): Point[] {
	const radius = hull.radius + margin;
	const points = convexOrder(hull.points);
	if (radius < 0) return points.length >= 3 ? insetConvex(points, -radius) : [];
	if (radius === 0) return points.length >= 3 ? points : [];
	const outline: Point[] = [];
	const count = points.length;
	for (let index = 0; index < count; index++) {
		const point = points[index];
		const previous = points[(index + count - 1) % count];
		const next = points[(index + 1) % count];
		const normal = (from: Point, to: Point) => {
			const dx = to.x - from.x;
			const dy = to.y - from.y;
			const length = Math.hypot(dx, dy) || 1;
			return Math.atan2(-dx / length, dy / length);
		};
		let start: number;
		let end: number;
		if (count === 1) {
			start = 0;
			end = 2 * Math.PI;
		} else {
			start = normal(previous, point);
			end = normal(point, next);
			while (end < start) end += 2 * Math.PI;
		}
		const steps = Math.max(1, Math.ceil((end - start) / step));
		for (let n = 0; n <= steps; n++) {
			if (count === 1 && n === steps) break;
			const angle = start + ((end - start) * n) / steps;
			outline.push({
				x: point.x + radius * Math.cos(angle),
				y: point.y + radius * Math.sin(angle),
			});
		}
	}
	return outline;
}

function insetConvex(points: readonly Point[], distance: number): Point[] {
	const count = points.length;
	const normals = points.map((point, index) => {
		const next = points[(index + 1) % count];
		const length = Math.hypot(next.x - point.x, next.y - point.y) || 1;
		return {
			x: -(next.y - point.y) / length,
			y: (next.x - point.x) / length,
		};
	});
	const inset = points.map((point, index) => {
		const before = normals[(index + count - 1) % count];
		const after = normals[index];
		const scale = distance / (1 + before.x * after.x + before.y * after.y);
		return {
			x: point.x + (before.x + after.x) * scale,
			y: point.y + (before.y + after.y) * scale,
		};
	});
	const collapsed = inset.some((point, index) => {
		const next = inset[(index + 1) % count];
		const from = points[index];
		const to = points[(index + 1) % count];
		return (
			(next.x - point.x) * (to.x - from.x) +
				(next.y - point.y) * (to.y - from.y) <=
			0
		);
	});
	return collapsed ? [] : inset;
}

/** Points in counterclockwise order. Two points stay as they are. */
function convexOrder(points: readonly Point[]): Point[] {
	if (points.length < 3) return [...points];
	let area = 0;
	for (let index = 0; index < points.length; index++) {
		const a = points[index];
		const b = points[(index + 1) % points.length];
		area += a.x * b.y - b.x * a.y;
	}
	return area < 0 ? [...points].reverse() : [...points];
}

export function trackSegment(
	id: number,
	from: Point,
	to: Point,
	layer: CopperLayer,
	width: number,
	net: string | undefined,
): LineShape {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	return {
		id,
		kind: "line",
		layer,
		x: (from.x + to.x) / 2,
		y: (from.y + to.y) / 2,
		width: Math.hypot(dx, dy),
		height: 1,
		rotation: Math.atan2(dy, dx),
		lineWidth: width,
		...(net ? { net } : {}),
	};
}
