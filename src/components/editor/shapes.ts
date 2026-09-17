import type { Bounds, Point } from "#/engine/types";

export const A3 = { width: 420, height: 297 } as const;
export type ShapeKind = "rectangle" | "circle" | "triangle" | "line";
export interface EditorShape extends Point {
	id: number;
	kind: ShapeKind;
	width: number;
	height: number;
	rotation: number;
}

/** Rectangles and triangles use opposite corners; circles use center/radius; lines use endpoints. */
export function drawShape(
	id: number,
	kind: ShapeKind,
	start: Point,
	end: Point,
): EditorShape {
	const first = start;
	const last = end;
	const dx = last.x - first.x;
	const dy = last.y - first.y;
	if (kind === "circle") {
		const radius = Math.hypot(dx, dy);
		return {
			id,
			kind,
			...first,
			width: radius * 2,
			height: radius * 2,
			rotation: 0,
		};
	}
	return {
		id,
		kind,
		x: (first.x + last.x) / 2,
		y: (first.y + last.y) / 2,
		width: kind === "line" ? Math.hypot(dx, dy) : Math.abs(dx),
		height: kind === "line" ? 1 : Math.abs(dy),
		rotation: kind === "line" ? Math.atan2(dy, dx) : 0,
	};
}

export function shapeBounds(shape: EditorShape): Bounds {
	const cos = Math.abs(Math.cos(shape.rotation));
	const sin = Math.abs(Math.sin(shape.rotation));
	const halfWidth = (shape.width * cos + shape.height * sin) / 2;
	const halfHeight = (shape.width * sin + shape.height * cos) / 2;
	return {
		minX: shape.x - halfWidth,
		maxX: shape.x + halfWidth,
		minY: shape.y - halfHeight,
		maxY: shape.y + halfHeight,
	};
}

export function hitShape(shape: EditorShape, point: Point, tolerance: number) {
	const { width, height } = shape;
	const dx = point.x - shape.x;
	const dy = point.y - shape.y;
	const x = Math.abs(
		dx * Math.cos(shape.rotation) + dy * Math.sin(shape.rotation),
	);
	const y = -dx * Math.sin(shape.rotation) + dy * Math.cos(shape.rotation);
	if (shape.kind === "circle") return Math.hypot(x, y) <= width / 2;
	if (shape.kind === "triangle") {
		return (
			height > 0 &&
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
	const { width, height } = shape;
	if (shape.kind === "circle") {
		const x = Math.max(bounds.minX, Math.min(bounds.maxX, shape.x));
		const y = Math.max(bounds.minY, Math.min(bounds.maxY, shape.y));
		return Math.hypot(x - shape.x, y - shape.y) <= width / 2;
	}
	const own = shapeBounds(shape);
	if (
		own.maxX < bounds.minX ||
		own.minX > bounds.maxX ||
		own.maxY < bounds.minY ||
		own.minY > bounds.maxY
	)
		return false;
	if (shape.kind === "line") {
		// The remaining separating axes are the line's local X and Y axes.
		const dx = (bounds.minX + bounds.maxX) / 2 - shape.x;
		const dy = (bounds.minY + bounds.maxY) / 2 - shape.y;
		const halfWidth = (bounds.maxX - bounds.minX) / 2;
		const halfHeight = (bounds.maxY - bounds.minY) / 2;
		const cos = Math.cos(shape.rotation),
			sin = Math.sin(shape.rotation);
		return (
			Math.abs(dx * cos + dy * sin) <=
				width / 2 + halfWidth * Math.abs(cos) + halfHeight * Math.abs(sin) &&
			Math.abs(-dx * sin + dy * cos) <=
				height / 2 + halfWidth * Math.abs(sin) + halfHeight * Math.abs(cos)
		);
	}
	if (shape.kind !== "triangle") return true;
	const y = Math.max(own.minY, bounds.minY);
	const halfWidth = height > 0 ? ((width / 2) * (own.maxY - y)) / height : 0;
	return (
		shape.x + halfWidth >= bounds.minX && shape.x - halfWidth <= bounds.maxX
	);
}

/** Translate every selected shape equally, including outside the paper guide. */
export function moveShapes(shapes: EditorShape[], delta: Point): EditorShape[] {
	return shapes.map((shape) => ({
		...shape,
		x: shape.x + delta.x,
		y: shape.y + delta.y,
	}));
}
