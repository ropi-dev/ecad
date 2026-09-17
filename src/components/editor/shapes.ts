import type { Bounds, Point } from "#/engine/types";

export const A3 = { width: 420, height: 297 } as const;
export const shapeSizes = {
	rectangle: { width: 50, height: 30 },
	circle: { width: 30, height: 30 },
	triangle: { width: 40, height: 35 },
	line: { width: 55, height: 1 },
} as const;
export type ShapeKind = keyof typeof shapeSizes;
export interface EditorShape extends Point {
	id: number;
	kind: ShapeKind;
}

export function placeShape(shape: EditorShape, point: Point): EditorShape {
	const { width, height } = shapeSizes[shape.kind];
	return {
		...shape,
		x: Math.max(width / 2, Math.min(A3.width - width / 2, point.x)),
		y: Math.max(height / 2, Math.min(A3.height - height / 2, point.y)),
	};
}

export function hitShape(shape: EditorShape, point: Point, tolerance: number) {
	const { width, height } = shapeSizes[shape.kind];
	const x = Math.abs(point.x - shape.x);
	const y = point.y - shape.y;
	if (shape.kind === "circle") return Math.hypot(x, y) <= width / 2;
	if (shape.kind === "triangle") {
		return (
			y >= -height / 2 &&
			y <= height / 2 &&
			x <= (width / 2) * (0.5 - y / height)
		);
	}
	return (
		x <= width / 2 &&
		Math.abs(y) <= Math.max(height / 2, shape.kind === "line" ? tolerance : 0)
	);
}

/** Select any shape touched by the rectangle, including partially covered shapes. */
export function intersectsSelection(shape: EditorShape, bounds: Bounds) {
	const { width, height } = shapeSizes[shape.kind];
	if (shape.kind === "circle") {
		const x = Math.max(bounds.minX, Math.min(bounds.maxX, shape.x));
		const y = Math.max(bounds.minY, Math.min(bounds.maxY, shape.y));
		return Math.hypot(x - shape.x, y - shape.y) <= width / 2;
	}
	const left = shape.x - width / 2;
	const right = shape.x + width / 2;
	const bottom = shape.y - height / 2;
	const top = shape.y + height / 2;
	if (
		right < bounds.minX ||
		left > bounds.maxX ||
		top < bounds.minY ||
		bottom > bounds.maxY
	)
		return false;
	if (shape.kind !== "triangle") return true;
	// At the lowest overlapping Y, the triangle has its widest overlapping slice.
	const y = Math.max(bottom, bounds.minY);
	const halfWidth = ((width / 2) * (top - y)) / height;
	return (
		shape.x + halfWidth >= bounds.minX && shape.x - halfWidth <= bounds.maxX
	);
}

/** Clamp the whole selection together so its spacing survives contact with the sheet edge. */
export function moveShapes(shapes: EditorShape[], delta: Point): EditorShape[] {
	if (!shapes.length) return shapes;
	let minX = -Infinity,
		maxX = Infinity,
		minY = -Infinity,
		maxY = Infinity;
	for (const shape of shapes) {
		const { width, height } = shapeSizes[shape.kind];
		minX = Math.max(minX, width / 2 - shape.x);
		maxX = Math.min(maxX, A3.width - width / 2 - shape.x);
		minY = Math.max(minY, height / 2 - shape.y);
		maxY = Math.min(maxY, A3.height - height / 2 - shape.y);
	}
	const x = Math.max(minX, Math.min(maxX, delta.x));
	const y = Math.max(minY, Math.min(maxY, delta.y));
	return shapes.map((shape) => ({ ...shape, x: shape.x + x, y: shape.y + y }));
}
