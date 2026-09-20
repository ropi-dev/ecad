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

export interface ResizeHandle extends Point {
	id: string;
	xDirection: number;
	yDirection: number;
	cursor: string;
}

export function snapCoordinate(value: number, step: number): number {
	return step > 0
		? Number((Math.round(value / step) * step).toPrecision(12))
		: value;
}

export function snapPoint(point: Point, step: number): Point {
	return { x: snapCoordinate(point.x, step), y: snapCoordinate(point.y, step) };
}

function localToWorld(shape: EditorShape, x: number, y: number): Point {
	return {
		x: shape.x + x * Math.cos(shape.rotation) - y * Math.sin(shape.rotation),
		y: shape.y + x * Math.sin(shape.rotation) + y * Math.cos(shape.rotation),
	};
}

/** Handle positions use the same local axes as the rendered shape. */
export function resizeHandles(shape: EditorShape): ResizeHandle[] {
	const directions =
		shape.kind === "line"
			? [
					[-1, 0],
					[1, 0],
				]
			: shape.kind === "circle"
				? [
						[-1, 0],
						[1, 0],
						[0, -1],
						[0, 1],
					]
				: [
						[-1, -1],
						[0, -1],
						[1, -1],
						[-1, 0],
						[1, 0],
						[-1, 1],
						[0, 1],
						[1, 1],
					];
	return directions.map(([xDirection, yDirection]) => {
		const angle = Math.atan2(yDirection, xDirection) + shape.rotation;
		const cursor = ["ew-resize", "nesw-resize", "ns-resize", "nwse-resize"][
			((Math.round(angle / (Math.PI / 4)) % 4) + 4) % 4
		];
		return {
			...localToWorld(
				shape,
				(xDirection * shape.width) / 2,
				(yDirection * shape.height) / 2,
			),
			id: `${xDirection},${yDirection}`,
			xDirection,
			yDirection,
			cursor: shape.kind === "line" ? "crosshair" : cursor,
		};
	});
}

/** Resize from the initial shape so a drag never accumulates rounding errors. */
export function resizeShape(
	shape: EditorShape,
	handle: ResizeHandle,
	delta: Point,
	gridStep = 0,
): EditorShape {
	const target = { x: handle.x + delta.x, y: handle.y + delta.y };
	if (shape.kind === "circle") {
		const radius = Math.max(
			gridStep,
			0.05,
			snapCoordinate(
				Math.hypot(target.x - shape.x, target.y - shape.y),
				gridStep,
			),
		);
		const diameter = radius * 2;
		return { ...shape, width: diameter, height: diameter };
	}
	const point = snapPoint(target, gridStep);
	if (shape.kind === "line") {
		const fixed = localToWorld(
			shape,
			(-handle.xDirection * shape.width) / 2,
			0,
		);
		const length = Math.hypot(point.x - fixed.x, point.y - fixed.y);
		if (length < 0.1) {
			if (gridStep > 0) return shape;
			point.x =
				fixed.x +
				(length > 0
					? (point.x - fixed.x) / length
					: handle.xDirection * Math.cos(shape.rotation)) *
					0.1;
			point.y =
				fixed.y +
				(length > 0
					? (point.y - fixed.y) / length
					: handle.xDirection * Math.sin(shape.rotation)) *
					0.1;
		}
		return handle.xDirection === 1
			? drawShape(shape.id, "line", fixed, point)
			: drawShape(shape.id, "line", point, fixed);
	}
	const deltaX = point.x - handle.x;
	const deltaY = point.y - handle.y;
	const dx =
		deltaX * Math.cos(shape.rotation) + deltaY * Math.sin(shape.rotation);
	const dy =
		-deltaX * Math.sin(shape.rotation) + deltaY * Math.cos(shape.rotation);
	const width = Math.max(
		handle.xDirection ? gridStep : 0,
		0.1,
		shape.width + handle.xDirection * dx,
	);
	const height = Math.max(
		handle.yDirection ? gridStep : 0,
		0.1,
		shape.height + handle.yDirection * dy,
	);
	return {
		...shape,
		...localToWorld(
			shape,
			(handle.xDirection * (width - shape.width)) / 2,
			(handle.yDirection * (height - shape.height)) / 2,
		),
		width,
		height,
	};
}

/** Rectangles and triangles use opposite corners; circles use center/radius; lines use endpoints. */
export function drawShape(
	id: number,
	kind: ShapeKind,
	start: Point,
	end: Point,
	gridStep = 0,
): EditorShape {
	const first = snapPoint(start, gridStep);
	const last = kind === "circle" ? end : snapPoint(end, gridStep);
	const dx = last.x - first.x;
	const dy = last.y - first.y;
	if (kind === "circle") {
		const radius = snapCoordinate(Math.hypot(dx, dy), gridStep);
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
export function moveShapes(
	shapes: EditorShape[],
	delta: Point,
	gridStep = 0,
	anchorShape = shapes[0],
): EditorShape[] {
	if (gridStep > 0 && anchorShape) {
		// Keep corners on the grid even when the center lies halfway between lines.
		const anchor =
			anchorShape.kind === "circle"
				? anchorShape
				: localToWorld(
						anchorShape,
						-anchorShape.width / 2,
						anchorShape.kind === "line" ? 0 : -anchorShape.height / 2,
					);
		const target = snapPoint(
			{ x: anchor.x + delta.x, y: anchor.y + delta.y },
			gridStep,
		);
		delta = { x: target.x - anchor.x, y: target.y - anchor.y };
	}
	return shapes.map((shape) => ({
		...shape,
		x: shape.x + delta.x,
		y: shape.y + delta.y,
	}));
}
