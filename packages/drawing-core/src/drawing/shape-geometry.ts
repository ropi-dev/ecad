import type {
	BasicShape,
	EditorShape,
	PinShape,
	PrimitiveShape,
} from "#/drawing/schema.ts";
import type { ShapeKind } from "#/drawing/shape-kinds.ts";
import {
	DEFAULT_LINE_WIDTH,
	isBoxSymbol,
	PIN_RADIUS,
} from "#/drawing/shape-types.ts";
import { textCenter } from "#/drawing/text-alignment.ts";
import type { Bounds, Point } from "#/drawing/types.ts";
import { DEFAULT_PIN_LENGTH } from "#/drawing/units.ts";

export function shapeCenter(shape: EditorShape): Point {
	if (shape.kind === "text") return textCenter(shape);
	if (isBoxSymbol(shape))
		return localToWorld(shape, shape.width / 2, -shape.height / 2);
	return { x: shape.x, y: shape.y };
}

export function snapCoordinate(value: number, step: number): number {
	return step > 0
		? Number((Math.round(value / step) * step).toPrecision(12))
		: value;
}

export function snapPoint(point: Point, step: number): Point {
	return { x: snapCoordinate(point.x, step), y: snapCoordinate(point.y, step) };
}

export function constrainWireEndpoint(
	start: Point,
	end: Point,
	gridStep = 0,
): Point {
	const target = snapPoint(end, gridStep);
	return Math.abs(target.x - start.x) >= Math.abs(target.y - start.y)
		? { x: target.x, y: start.y }
		: { x: start.x, y: target.y };
}

export function localToWorld(shape: EditorShape, x: number, y: number): Point {
	return {
		x: shape.x + x * Math.cos(shape.rotation) - y * Math.sin(shape.rotation),
		y: shape.y + x * Math.sin(shape.rotation) + y * Math.cos(shape.rotation),
	};
}

export function drawShape(
	id: number,
	kind: Exclude<ShapeKind, "text">,
	start: Point,
	end: Point,
	gridStep = 0,
): PrimitiveShape {
	const first = snapPoint(start, gridStep);
	if (kind === "no-connect")
		return {
			id,
			kind,
			...first,
			width: 1.27,
			height: 1.27,
			rotation: 0,
			lineWidth: DEFAULT_LINE_WIDTH,
		};
	if (kind === "pin")
		return {
			id,
			kind,
			name: "",
			number: "",
			length: DEFAULT_PIN_LENGTH,
			...first,
			width: 2 * PIN_RADIUS,
			height: 2 * PIN_RADIUS,
			rotation: 0,
			lineWidth: DEFAULT_LINE_WIDTH,
		};
	const last =
		kind === "circle"
			? end
			: kind === "wire"
				? constrainWireEndpoint(first, end, gridStep)
				: snapPoint(end, gridStep);
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
			lineWidth: DEFAULT_LINE_WIDTH,
		};
	}
	return {
		id,
		kind,
		x: (first.x + last.x) / 2,
		y: (first.y + last.y) / 2,
		width:
			kind === "wire" || kind === "line" ? Math.hypot(dx, dy) : Math.abs(dx),
		height: kind === "wire" || kind === "line" ? 1 : Math.abs(dy),
		rotation: kind === "wire" || kind === "line" ? Math.atan2(dy, dx) : 0,
		lineWidth: DEFAULT_LINE_WIDTH,
	};
}

export function pinLeadShape(pin: PinShape): BasicShape {
	const length = pin.length ?? 0;
	return {
		...pin,
		kind: "line",
		x: pin.x + (Math.cos(pin.rotation) * length) / 2,
		y: pin.y + (Math.sin(pin.rotation) * length) / 2,
		width: length,
		height: pin.lineWidth,
	};
}

export function mergeBounds(boxes: readonly Bounds[]): Bounds {
	return {
		minX: Math.min(...boxes.map((box) => box.minX)),
		minY: Math.min(...boxes.map((box) => box.minY)),
		maxX: Math.max(...boxes.map((box) => box.maxX)),
		maxY: Math.max(...boxes.map((box) => box.maxY)),
	};
}

export function expandBounds(bounds: Bounds, by: number): Bounds {
	return {
		minX: bounds.minX - by,
		minY: bounds.minY - by,
		maxX: bounds.maxX + by,
		maxY: bounds.maxY + by,
	};
}

export function shapeBounds(shape: EditorShape): Bounds {
	if (shape.kind === "pin" && (shape.length ?? 0) > 0) {
		const length = shape.length ?? 0;
		const endX = shape.x + Math.cos(shape.rotation) * length;
		const endY = shape.y + Math.sin(shape.rotation) * length;
		const radius = shape.lineWidth / 2;
		return {
			minX: Math.min(shape.x - PIN_RADIUS, endX - radius),
			maxX: Math.max(shape.x + PIN_RADIUS, endX + radius),
			minY: Math.min(shape.y - PIN_RADIUS, endY - radius),
			maxY: Math.max(shape.y + PIN_RADIUS, endY + radius),
		};
	}
	const center = shapeCenter(shape);
	const height =
		shape.kind === "wire" || shape.kind === "line"
			? shape.lineWidth
			: shape.height;
	const cos = Math.abs(Math.cos(shape.rotation));
	const sin = Math.abs(Math.sin(shape.rotation));
	const halfWidth = (shape.width * cos + height * sin) / 2;
	const halfHeight = (shape.width * sin + height * cos) / 2;
	return {
		minX: center.x - halfWidth,
		maxX: center.x + halfWidth,
		minY: center.y - halfHeight,
		maxY: center.y + halfHeight,
	};
}
