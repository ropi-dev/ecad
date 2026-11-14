import {
	type EditorShape,
	shapeCenter,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Bounds, Point } from "@ecad/drawing-core/drawing/types.ts";

const circleSides = 48;

/** The closed path around a footprint item, in drawing coordinates. */
export function shapeOutline(shape: EditorShape): Point[] {
	const center = shapeCenter(shape);
	const cos = Math.cos(shape.rotation);
	const sin = Math.sin(shape.rotation);
	const at = (x: number, y: number) => ({
		x: center.x + x * cos - y * sin,
		y: center.y + x * sin + y * cos,
	});
	const right = shape.width / 2;
	const top = (shape.kind === "line" ? shape.lineWidth : shape.height) / 2;
	if (shape.kind === "circle")
		return Array.from({ length: circleSides }, (_, side) => {
			const angle = (2 * Math.PI * side) / circleSides;
			return at(right * Math.cos(angle), right * Math.sin(angle));
		});
	if (shape.kind === "triangle")
		return [at(-right, -top), at(right, -top), at(0, top)];
	return [at(-right, -top), at(right, -top), at(right, top), at(-right, top)];
}

const inside = (point: Point, box: Bounds) =>
	point.x >= box.minX &&
	point.x <= box.maxX &&
	point.y >= box.minY &&
	point.y <= box.maxY;

function crosses(a: Point, b: Point, c: Point, d: Point) {
	const side = (p: Point, q: Point, r: Point) =>
		Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
	return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

function contains(outline: readonly Point[], point: Point) {
	let within = false;
	for (let index = 0; index < outline.length; index++) {
		const a = outline[index];
		const b = outline[(index + 1) % outline.length];
		if (
			a.y > point.y !== b.y > point.y &&
			point.x < a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x)
		)
			within = !within;
	}
	return within;
}

/**
 * Whether a selection rectangle picks a closed outline. A window rectangle
 * needs the whole outline, and a crossing one any part of its area.
 */
export function outlineInBox(
	outline: readonly Point[],
	box: Bounds,
	mode: "window" | "crossing",
): boolean {
	if (!outline.length) return false;
	if (mode === "window") return outline.every((point) => inside(point, box));
	if (outline.some((point) => inside(point, box))) return true;
	const corners = [
		{ x: box.minX, y: box.minY },
		{ x: box.maxX, y: box.minY },
		{ x: box.maxX, y: box.maxY },
		{ x: box.minX, y: box.maxY },
	];
	return (
		contains(outline, corners[0]) ||
		outline.some((point, index) => {
			const next = outline[(index + 1) % outline.length];
			return corners.some((corner, side) =>
				crosses(point, next, corner, corners[(side + 1) % 4]),
			);
		})
	);
}
