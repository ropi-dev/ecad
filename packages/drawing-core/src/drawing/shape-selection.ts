import type { EditorShape, EditorSymbol } from "#/drawing/schema.ts";
import {
	localToWorld,
	pinLeadShape,
	shapeBounds,
	shapeCenter,
} from "#/drawing/shape-geometry.ts";
import { isBoxSymbol, type SymbolChild } from "#/drawing/shape-types.ts";
import {
	boxBorder,
	canSelectSymbolChild,
	symbolChildren,
	symbolChildWorld,
	symbolShapes,
	symbolTextShapes,
} from "#/drawing/symbol-instances.ts";
import type { Bounds, Point } from "#/drawing/types.ts";

export function selectionSize(shape: EditorShape) {
	if (shape.kind === "pin" && (shape.length ?? 0) > 0) {
		const bounds = shapeBounds(shape);
		return {
			width: bounds.maxX - bounds.minX + 4,
			height: bounds.maxY - bounds.minY + 4,
		};
	}
	const padding = isBoxSymbol(shape)
		? 0
		: shape.kind === "symbol" ||
				shape.kind === "wire" ||
				shape.kind === "no-connect"
			? 0.5
			: 4;
	return {
		width: shape.width + padding,
		height:
			(shape.kind === "wire" || shape.kind === "line"
				? shape.lineWidth
				: shape.height) + padding,
	};
}

export function symbolSelectionFrame(
	symbol: EditorSymbol,
): Point & { width: number; height: number; rotation: number } {
	if (isBoxSymbol(symbol))
		return {
			...shapeCenter(symbol),
			...selectionSize(symbol),
			rotation: symbol.rotation,
		};
	// Unresolved symbols keep no children; fall back to their stored size.
	if (!symbol.children.length)
		return {
			...shapeCenter(symbol),
			...selectionSize(symbol),
			rotation: symbol.rotation,
		};
	const local = { ...symbol, x: 0, y: 0, rotation: 0 };
	const boxes = symbolShapes(local).map(shapeBounds);
	const minX = Math.min(...boxes.map((box) => box.minX));
	const maxX = Math.max(...boxes.map((box) => box.maxX));
	const minY = Math.min(...boxes.map((box) => box.minY));
	const maxY = Math.max(...boxes.map((box) => box.maxY));
	const padding = selectionSize(symbol).width - symbol.width;
	return {
		...localToWorld(symbol, (minX + maxX) / 2, (minY + maxY) / 2),
		width: maxX - minX + padding,
		height: maxY - minY + padding,
		rotation: symbol.rotation,
	};
}

function hitSymbolContent(
	symbol: EditorSymbol,
	point: Point,
	tolerance: number,
): boolean {
	return [...symbolTextShapes(symbol), ...symbolShapes(symbol)].some((child) =>
		hitShape(child, point, tolerance),
	);
}

/**
 * The topmost symbol child under a world point. Some symbols draw a pin as a
 * zero-length terminal with a separate locked lead line, so a press on that
 * line picks the pin it ends at.
 */
export function symbolChildAt(
	symbol: EditorSymbol,
	point: Point,
	tolerance = 0,
	allowLocked = false,
): SymbolChild | undefined {
	const children = symbolChildren(symbol);
	const hit = [...children]
		.reverse()
		.find((child) =>
			hitShape(symbolChildWorld(symbol, child.shape), point, tolerance),
		);
	if (
		hit?.shape.kind !== "line" ||
		canSelectSymbolChild(symbol, hit, allowLocked)
	)
		return hit;
	const { width } = hit.shape;
	const ends = [
		localToWorld(hit.shape, -width / 2, 0),
		localToWorld(hit.shape, width / 2, 0),
	];
	return (
		children.find(
			(child) =>
				child.shape.kind === "pin" &&
				!child.shape.length &&
				ends.some(
					(end) =>
						Math.hypot(end.x - child.shape.x, end.y - child.shape.y) < 1e-6,
				),
		) ?? hit
	);
}

export function shapeAt<T extends EditorShape>(
	shapes: readonly T[],
	point: Point,
	tolerance: number,
	selectable: (shape: T) => boolean = () => true,
): T | undefined {
	let area: T | undefined;
	for (let index = shapes.length - 1; index >= 0; index--) {
		const shape = shapes[index];
		if (!selectable(shape)) continue;
		if (shape.kind !== "symbol" || isBoxSymbol(shape)) {
			if (hitShape(shape, point, tolerance)) return shape;
		} else if (hitSymbolContent(shape, point, tolerance)) return shape;
		else if (!area && hitShape(shape, point, tolerance)) area = shape;
	}
	return area;
}

export function hitShape(
	shape: EditorShape,
	point: Point,
	tolerance: number,
): boolean {
	if (isBoxSymbol(shape)) {
		const border = boxBorder(shape);
		return symbolChildren(shape).some((child) => {
			const world = symbolChildWorld(shape, child.shape);
			if (child.key !== border?.key) return hitShape(world, point, tolerance);
			const dx = point.x - world.x;
			const dy = point.y - world.y;
			const x = Math.abs(
				dx * Math.cos(world.rotation) + dy * Math.sin(world.rotation),
			);
			const y = Math.abs(
				-dx * Math.sin(world.rotation) + dy * Math.cos(world.rotation),
			);
			const radius = Math.max(world.lineWidth / 2, tolerance);
			return (
				x <= world.width / 2 + radius &&
				y <= world.height / 2 + radius &&
				(x >= world.width / 2 - radius || y >= world.height / 2 - radius)
			);
		});
	}
	if (shape.kind === "symbol" && hitSymbolContent(shape, point, tolerance))
		return true;
	const { width, height, ...center } =
		shape.kind === "symbol"
			? symbolSelectionFrame(shape)
			: { ...shape, ...shapeCenter(shape) };
	const dx = point.x - center.x;
	const dy = point.y - center.y;
	if (shape.kind === "pin")
		return (
			Math.hypot(dx, dy) <= Math.max(width / 2, tolerance) ||
			((shape.length ?? 0) > 0 &&
				hitShape(pinLeadShape(shape), point, tolerance))
		);
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
		Math.abs(y) <=
			(shape.kind === "wire" || shape.kind === "line"
				? Math.max(shape.lineWidth / 2, tolerance)
				: height / 2)
	);
}

export function containsSelection(shape: EditorShape, bounds: Bounds): boolean {
	if (shape.kind === "symbol") {
		const fits = [...symbolTextShapes(shape), ...symbolShapes(shape)].every(
			(child) => containsSelection(child, bounds),
		);
		// The stored size is symmetric about the origin, so only box symbols
		// add their border on top of their children. Unresolved symbols have no
		// children and fall back to their stored bounds.
		if (!fits || (!isBoxSymbol(shape) && shape.children.length)) return fits;
	}
	const own = shapeBounds(
		shape.kind === "circle" || (shape.kind === "pin" && !shape.length)
			? { ...shape, rotation: 0 }
			: shape,
	);
	return (
		own.minX >= bounds.minX &&
		own.maxX <= bounds.maxX &&
		own.minY >= bounds.minY &&
		own.maxY <= bounds.maxY
	);
}

export function intersectsSelection(
	shape: EditorShape,
	bounds: Bounds,
): boolean {
	if (shape.kind === "symbol")
		return (
			[...symbolTextShapes(shape), ...symbolShapes(shape)].some((child) =>
				intersectsSelection(child, bounds),
			) ||
			intersectsSelection(
				{
					...shape,
					kind: "rectangle",
					...symbolSelectionFrame(shape),
				},
				bounds,
			)
		);
	const { width, height } = shape;
	if (shape.kind === "pin" && (shape.length ?? 0) > 0)
		return (
			intersectsSelection(pinLeadShape(shape), bounds) ||
			intersectsSelection({ ...shape, length: 0 }, bounds)
		);
	if (shape.kind === "circle" || shape.kind === "pin") {
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
	if (shape.kind === "wire" || shape.kind === "line") {
		// The remaining separating axes are the segment's local X and Y axes.
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
				shape.lineWidth / 2 +
					halfWidth * Math.abs(sin) +
					halfHeight * Math.abs(cos)
		);
	}
	if (shape.kind !== "triangle") return true;
	const y = Math.max(own.minY, bounds.minY);
	const halfWidth = height > 0 ? ((width / 2) * (own.maxY - y)) / height : 0;
	return (
		shape.x + halfWidth >= bounds.minX && shape.x - halfWidth <= bounds.maxX
	);
}
