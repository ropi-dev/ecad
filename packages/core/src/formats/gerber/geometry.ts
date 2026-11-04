import type { Bounds, Geometry, Matrix, Point } from "#/engine/types.ts";

export interface Shape {
	geometry: Geometry;
	bounds: Bounds;
}
export const identity: Matrix = [1, 0, 0, 1, 0, 0];
export const emptyBounds = (): Bounds => ({
	minX: Infinity,
	minY: Infinity,
	maxX: -Infinity,
	maxY: -Infinity,
});
export const finiteBounds = (bounds: Bounds): Bounds =>
	Number.isFinite(bounds.minX)
		? bounds
		: { minX: 0, minY: 0, maxX: 0, maxY: 0 };
export function union(a: Bounds, b: Bounds): Bounds {
	return {
		minX: Math.min(a.minX, b.minX),
		minY: Math.min(a.minY, b.minY),
		maxX: Math.max(a.maxX, b.maxX),
		maxY: Math.max(a.maxY, b.maxY),
	};
}
export function pointsBounds(points: Point[], padding = 0): Bounds {
	const b = points.reduce(
		(a, p) => union(a, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }),
		emptyBounds(),
	);
	return {
		minX: b.minX - padding,
		minY: b.minY - padding,
		maxX: b.maxX + padding,
		maxY: b.maxY + padding,
	};
}
export function multiply(a: Matrix, b: Matrix): Matrix {
	return [
		a[0] * b[0] + a[2] * b[1],
		a[1] * b[0] + a[3] * b[1],
		a[0] * b[2] + a[2] * b[3],
		a[1] * b[2] + a[3] * b[3],
		a[0] * b[4] + a[2] * b[5] + a[4],
		a[1] * b[4] + a[3] * b[5] + a[5],
	];
}
export const transformPoint = (p: Point, m: Matrix): Point => ({
	x: m[0] * p.x + m[2] * p.y + m[4],
	y: m[1] * p.x + m[3] * p.y + m[5],
});
export const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export function apertureMatrix(
	mirror: string,
	rotation: number,
	scale: number,
): Matrix {
	const a = (rotation * Math.PI) / 180,
		c = Math.cos(a) * scale,
		s = Math.sin(a) * scale;
	const x = mirror.includes("X") ? -1 : 1,
		y = mirror.includes("Y") ? -1 : 1;
	return [c * x, s * x, -s * y, c * y, 0, 0];
}
export function transformBounds(b: Bounds, matrix: Matrix): Bounds {
	return pointsBounds(
		[
			{ x: b.minX, y: b.minY },
			{ x: b.minX, y: b.maxY },
			{ x: b.maxX, y: b.minY },
			{ x: b.maxX, y: b.maxY },
		].map((p) => transformPoint(p, matrix)),
	);
}
export function circle(x: number, y: number, radius: number): Shape {
	return {
		geometry: { type: "circle", x, y, radius },
		bounds: {
			minX: x - radius,
			minY: y - radius,
			maxX: x + radius,
			maxY: y + radius,
		},
	};
}
export function polygon(points: Point[]): Shape {
	return {
		geometry: {
			type: "path",
			d: points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ") + " Z",
			fill: true,
		},
		bounds: pointsBounds(points),
	};
}
export function rectangle(
	x: number,
	y: number,
	width: number,
	height: number,
	rotation = 0,
): Shape {
	if (!rotation)
		return {
			geometry: { type: "rect", x, y, width, height },
			bounds: {
				minX: x - width / 2,
				minY: y - height / 2,
				maxX: x + width / 2,
				maxY: y + height / 2,
			},
		};
	const matrix = apertureMatrix("N", rotation, 1);
	return polygon(
		[
			{ x: x - width / 2, y: y - height / 2 },
			{ x: x + width / 2, y: y - height / 2 },
			{ x: x + width / 2, y: y + height / 2 },
			{ x: x - width / 2, y: y + height / 2 },
		].map((p) => transformPoint(p, matrix)),
	);
}
export function regularPolygon(
	vertices: number,
	x: number,
	y: number,
	diameter: number,
	rotation: number,
): Shape {
	const m = apertureMatrix("N", rotation, 1);
	return polygon(
		Array.from({ length: vertices }, (_, i) =>
			transformPoint(
				{
					x: x + (diameter / 2) * Math.cos((i * 2 * Math.PI) / vertices),
					y: y + (diameter / 2) * Math.sin((i * 2 * Math.PI) / vertices),
				},
				m,
			),
		),
	);
}
export function group(
	children: { shape: Shape; polarity: "dark" | "clear" }[],
): Shape {
	return {
		geometry: {
			type: "group",
			children: children.map((c) => ({
				geometry: c.shape.geometry,
				polarity: c.polarity,
			})),
		},
		bounds: children
			.filter((c) => c.polarity === "dark")
			.reduce((a, c) => union(a, c.shape.bounds), emptyBounds()),
	};
}
export function obround(width: number, height: number): Shape {
	const radius = Math.min(width, height) / 2,
		offset = Math.abs(width - height) / 2;
	const a = width > height ? { x: -offset, y: 0 } : { x: 0, y: -offset };
	const b = width > height ? { x: offset, y: 0 } : { x: 0, y: offset };
	return {
		geometry: {
			type: "path",
			d: `M${a.x} ${a.y} L${b.x} ${b.y}`,
			fill: false,
			strokeWidth: 2 * radius,
		},
		bounds: {
			minX: -width / 2,
			minY: -height / 2,
			maxX: width / 2,
			maxY: height / 2,
		},
	};
}
export function convexHull(points: Point[]): Point[] {
	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
	const cross = (o: Point, a: Point, b: Point) =>
		(a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const half = (values: Point[]) => {
		const result: Point[] = [];
		for (const point of values) {
			while (
				result.length >= 2 &&
				cross(result[result.length - 2], result[result.length - 1], point) <= 0
			)
				result.pop();
			result.push(point);
		}
		return result;
	};
	return [...half(sorted).slice(0, -1), ...half(sorted.reverse()).slice(0, -1)];
}
