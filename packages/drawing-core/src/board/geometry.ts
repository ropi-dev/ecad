import type { EditorShape, LineShape } from "#/drawing/schema.ts";
import type { Bounds, Point } from "#/drawing/types.ts";
import type { CopperLayer } from "#/footprint/layers.ts";

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

export function rectangleCorners(shape: EditorShape): Point[] {
	const w = shape.width / 2;
	const h = shape.height / 2;
	return [
		rotate(shape, -w, -h),
		rotate(shape, w, -h),
		rotate(shape, w, h),
		rotate(shape, -w, h),
	];
}

/** The copper a board shape covers, in board coordinates. */
export function shapeHulls(shape: EditorShape): Hull[] {
	if (shape.kind === "line" || shape.kind === "wire")
		return [{ points: lineEnds(shape), radius: shape.lineWidth / 2 }];
	if (shape.kind === "circle") {
		const solid =
			shape.filled || shape.pad !== undefined || shape.via !== undefined;
		return [
			{
				points: [{ x: shape.x, y: shape.y }],
				radius: shape.width / 2 + (solid ? 0 : shape.lineWidth / 2),
			},
		];
	}
	if (shape.kind === "rectangle") {
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

/**
 * The hull's outline as a closed polygon, grown by `margin`. Rounded parts
 * use about one segment per `step` radians.
 */
export function hullPolygon(
	hull: Hull,
	margin = 0,
	step = Math.PI / 12,
): Point[] {
	const radius = hull.radius + margin;
	const points = convexOrder(hull.points);
	if (radius <= 0) return points.length >= 3 ? points : [];
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
