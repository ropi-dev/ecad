import type { EditorShape, EditorSymbol } from "#/drawing/schema.ts";
import {
	constrainWireEndpoint,
	drawShape,
	localToWorld,
	snapCoordinate,
	snapPoint,
} from "#/drawing/shape-geometry.ts";
import {
	canSelectShape,
	isBoxSymbol,
	type SymbolChild,
} from "#/drawing/shape-types.ts";
import {
	boxBorder,
	boxText,
	canSelectSymbolChild,
	replaceSymbolChild,
	symbolChildren,
	symbolChildWorld,
} from "#/drawing/symbol-instances.ts";
import { textCenter } from "#/drawing/text-alignment.ts";
import type { Point } from "#/drawing/types.ts";

export function moveSymbolChild(
	symbol: EditorSymbol,
	key: string,
	delta: Point,
	gridStep = 0,
	allowLocked = false,
): EditorSymbol {
	const child = symbolChildren(symbol).find((item) => item.key === key)?.shape;
	if (!child || !canSelectShape(symbol, allowLocked) || child.locked)
		return symbol;
	if (boxBorder(symbol)?.key === key) return symbol;
	const world = symbolChildWorld(symbol, child);
	const target = snapPoint(
		{ x: world.x + delta.x, y: world.y + delta.y },
		gridStep,
	);
	const dx = target.x - symbol.x;
	const dy = target.y - symbol.y;
	return replaceSymbolChild(symbol, key, {
		...child,
		x: dx * Math.cos(symbol.rotation) + dy * Math.sin(symbol.rotation),
		y: -dx * Math.sin(symbol.rotation) + dy * Math.cos(symbol.rotation),
	});
}

export function resizeSymbolChild(
	symbol: EditorSymbol,
	key: string,
	handle: ResizeHandle,
	delta: Point,
	gridStep = 0,
	allowLocked = false,
): EditorSymbol {
	const child = symbolChildren(symbol).find((item) => item.key === key);
	if (!child || !canSelectSymbolChild(symbol, child, allowLocked))
		return symbol;
	return resizeSymbolGeometry(symbol, child, handle, delta, gridStep);
}

function resizeSymbolGeometry(
	symbol: EditorSymbol,
	child: SymbolChild,
	handle: ResizeHandle,
	delta: Point,
	gridStep: number,
): EditorSymbol {
	const resized = resizeShape(
		symbolChildWorld(symbol, child.shape),
		handle,
		delta,
		gridStep,
	);
	if (resized.kind === "symbol") return symbol;
	const dx = resized.x - symbol.x;
	const dy = resized.y - symbol.y;
	return replaceSymbolChild(symbol, child.key, {
		...resized,
		x: dx * Math.cos(symbol.rotation) + dy * Math.sin(symbol.rotation),
		y: -dx * Math.sin(symbol.rotation) + dy * Math.cos(symbol.rotation),
		rotation: resized.rotation - symbol.rotation,
	});
}

export type ShapeAttribute =
	| "x"
	| "y"
	| "width"
	| "height"
	| "radius"
	| "angle"
	| "fontSize"
	| "lineWidth"
	| "length";

export function editShapeAttribute(
	shape: EditorShape,
	attribute: ShapeAttribute,
	value: number,
): EditorShape {
	if (!Number.isFinite(value)) return shape;
	if (attribute === "x" || attribute === "y")
		return { ...shape, [attribute]: value };
	if (shape.kind === "pin") {
		if (attribute === "length")
			return value >= 0 && value <= 1000 ? { ...shape, length: value } : shape;
		if (attribute === "angle")
			return value % 90 === 0
				? { ...shape, rotation: (value * Math.PI) / 180 }
				: shape;
		if (attribute !== "lineWidth") return shape;
	}
	if (attribute === "angle") {
		// Wire drawing and junction movement require horizontal or vertical segments.
		if (
			shape.kind !== "text" &&
			shape.kind !== "line" &&
			((shape.kind !== "wire" && shape.kind !== "symbol") || value % 90 !== 0)
		)
			return shape;
		return { ...shape, rotation: (value * Math.PI) / 180 };
	}
	if (value <= 0) return shape;
	if (shape.kind === "symbol") {
		const border = boxBorder(shape);
		if (border && attribute === "lineWidth")
			return {
				...replaceSymbolChild(shape, border.key, {
					...border.shape,
					lineWidth: value,
				}),
				lineWidth: value,
				strokeOverride: value,
			};
		const text = boxText(shape);
		if (text && attribute === "fontSize") {
			const edited = editShapeAttribute(text.shape, attribute, value);
			return edited.kind === "text"
				? replaceSymbolChild(shape, text.key, edited)
				: shape;
		}
		if (border && (attribute === "width" || attribute === "height")) {
			const resized = { ...border.shape, [attribute]: value };
			return replaceSymbolChild(shape, border.key, {
				...resized,
				x: resized.width / 2,
				y: -resized.height / 2,
			});
		}
		return attribute === "lineWidth"
			? {
					...shape,
					lineWidth: value,
					strokeOverride: value,
					children: shape.children.map((child) => ({
						...child,
						lineWidth: child.kind === "text" ? child.lineWidth : value,
					})),
				}
			: shape;
	}
	if (
		attribute === "fontSize" ||
		(shape.kind === "text" && (attribute === "width" || attribute === "height"))
	) {
		if (shape.kind !== "text") return shape;
		const scale = value / shape[attribute];
		return {
			...shape,
			width: shape.width * scale,
			height: shape.height * scale,
			fontSize: shape.fontSize * scale,
		};
	}
	if (shape.kind === "text" && attribute === "lineWidth") return shape;
	if (attribute === "radius") {
		return shape.kind === "circle"
			? { ...shape, width: value * 2, height: value * 2 }
			: shape;
	}
	if (
		shape.kind === "circle" &&
		(attribute === "width" || attribute === "height")
	) {
		return { ...shape, width: value, height: value };
	}
	if (
		(shape.kind === "wire" || shape.kind === "line") &&
		attribute === "height"
	)
		return shape;
	return { ...shape, [attribute]: value };
}

export interface ResizeHandle extends Point {
	id: string;
	xDirection: number;
	yDirection: number;
	cursor: string;
}

export function resizeHandles(shape: EditorShape): ResizeHandle[] {
	if (isBoxSymbol(shape)) {
		const border = boxBorder(shape);
		return border ? resizeHandles(symbolChildWorld(shape, border.shape)) : [];
	}
	const center = shape.kind === "text" ? textCenter(shape) : shape;
	if (
		shape.kind === "symbol" ||
		shape.kind === "pin" ||
		shape.kind === "no-connect" ||
		(shape.kind === "text" && shape.electrical)
	)
		return [];
	const directions =
		shape.kind === "text"
			? [
					[-1, -1],
					[1, -1],
					[-1, 1],
					[1, 1],
				]
			: shape.kind === "wire" || shape.kind === "line"
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
				{ ...shape, x: center.x, y: center.y },
				(xDirection * shape.width) / 2,
				(yDirection * shape.height) / 2,
			),
			id: `${xDirection},${yDirection}`,
			xDirection,
			yDirection,
			cursor:
				shape.kind === "wire" || shape.kind === "line" ? "crosshair" : cursor,
		};
	});
}

export function resizeShape(
	shape: EditorShape,
	handle: ResizeHandle,
	delta: Point,
	gridStep = 0,
): EditorShape {
	if (isBoxSymbol(shape)) {
		const border = boxBorder(shape);
		return border
			? resizeSymbolGeometry(shape, border, handle, delta, gridStep)
			: shape;
	}
	if (
		shape.kind === "symbol" ||
		shape.kind === "pin" ||
		shape.kind === "no-connect" ||
		(shape.kind === "text" && shape.electrical)
	)
		return shape;
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
	if (shape.kind === "wire" || shape.kind === "line") {
		const fixed = localToWorld(
			shape,
			(-handle.xDirection * shape.width) / 2,
			0,
		);
		const point =
			shape.kind === "wire"
				? constrainWireEndpoint(fixed, target, gridStep)
				: snapPoint(target, gridStep);
		if (
			shape.kind === "line" &&
			Math.hypot(point.x - fixed.x, point.y - fixed.y) < 0.05
		)
			return shape;
		const resized =
			handle.xDirection === 1
				? drawShape(shape.id, shape.kind, fixed, point)
				: drawShape(shape.id, shape.kind, point, fixed);
		return { ...shape, ...resized, lineWidth: shape.lineWidth };
	}
	const point = snapPoint(target, gridStep);
	const deltaX = point.x - handle.x;
	const deltaY = point.y - handle.y;
	const dx =
		deltaX * Math.cos(shape.rotation) + deltaY * Math.sin(shape.rotation);
	const dy =
		-deltaX * Math.sin(shape.rotation) + deltaY * Math.cos(shape.rotation);
	if (shape.kind === "text") {
		const scale = Math.max(
			0.1 / shape.fontSize,
			1 +
				(handle.xDirection * dx * shape.width +
					handle.yDirection * dy * shape.height) /
					(shape.width ** 2 + shape.height ** 2),
		);
		const width = shape.width * scale;
		const height = shape.height * scale;
		const center = textCenter(shape);
		const offset = textCenter({ ...shape, x: 0, y: 0, width, height });
		return {
			...shape,
			...localToWorld(
				{ ...shape, x: center.x - offset.x, y: center.y - offset.y },
				(handle.xDirection * (width - shape.width)) / 2,
				(handle.yDirection * (height - shape.height)) / 2,
			),
			width,
			height,
			fontSize: shape.fontSize * scale,
		};
	}
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
