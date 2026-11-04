import type { LineStyle } from "#/drawing/line-style.ts";
import { electricalNets } from "#/drawing/named-nets.ts";
import type { SymbolLibraryReference } from "#/drawing/symbol-reference.ts";
import { type TextAlignment, textCenter } from "#/drawing/text-alignment.ts";
import type { Bounds, Point } from "#/drawing/types.ts";
import {
	CONNECTION_RADIUS,
	DEFAULT_PIN_LENGTH,
	DEFAULT_STROKE_WIDTH,
	SYMBOL_TEXT_SIZE,
} from "#/drawing/units.ts";
import { unionFind } from "#/lib/union-find.ts";

export const A3 = { width: 420, height: 297 } as const;
/** All connection markers have the same radius in millimetres. */
export const PIN_RADIUS = CONNECTION_RADIUS;
export const DEFAULT_LINE_WIDTH = DEFAULT_STROKE_WIDTH;
export type ShapeKind =
	| "rectangle"
	| "circle"
	| "triangle"
	| "line"
	| "wire"
	| "no-connect"
	| "pin"
	| "text";
interface ShapeGeometry extends Point {
	locked?: boolean;
	id: number;
	width: number;
	height: number;
	lineWidth: number;
	rotation: number;
}

export type BasicShape = ShapeGeometry & {
	kind: Exclude<ShapeKind, "text" | "pin" | "wire">;
	lineStyle?: LineStyle;
	filled?: boolean;
};

export type PrimitiveShape =
	| BasicShape
	| (ShapeGeometry & { kind: "wire" })
	| PinShape;

export interface PinShape extends ShapeGeometry {
	kind: "pin";
	name: string;
	number: string;
	length?: number;
	labelOffset?: number;
	showLabels?: boolean;
	showName?: boolean;
	showNumber?: boolean;
}

export interface EditorSymbol extends ShapeGeometry {
	kind: "symbol";
	definitionId: string;
	netSymbol?: boolean;
	library?: SymbolLibraryReference;
	kicad?: { libraryId: string; unit: number };
	/** An instance stroke override. Definition strokes otherwise remain unchanged. */
	strokeOverride?: number;
	/** Children use coordinates relative to the symbol's center. */
	children: SymbolShape[];
	texts: SymbolText[];
	childOverrides?: Record<string, SymbolChildOverride>;
	textAlignments?: Partial<Record<SymbolText["attribute"], TextAlignment>>;
	textPositions?: Partial<Record<SymbolText["attribute"], Point>>;
	attributes: { name: string; reference: string; value: string };
}

export function normalizeNetSymbol<T extends EditorSymbol>(symbol: T): T {
	if (!symbol.netSymbol) return symbol;
	const hasValueLabel = symbol.texts.some(
		(label) => label.attribute === "value",
	);
	const hasNameLabel = symbol.texts.some((label) => label.attribute === "name");
	const hasValue = Boolean(
		symbol.attributes.value.trim() ||
			symbol.textPositions?.value ||
			symbol.textAlignments?.value ||
			symbol.childOverrides?.["attribute:value"],
	);
	const source =
		hasValueLabel || (!hasNameLabel && hasValue) ? "value" : "name";
	const label = symbol.texts.find((label) => label.attribute === source) ?? {
		attribute: "name" as const,
		x: 0,
		y:
			Math.min(0, ...symbol.children.map((child) => shapeBounds(child).minY)) -
			SYMBOL_TEXT_SIZE,
		fontSize: SYMBOL_TEXT_SIZE,
	};
	const name = symbol.attributes.value.trim()
		? symbol.attributes.value
		: symbol.attributes.name;
	const position = symbol.textPositions?.[source] ?? symbol.textPositions?.name;
	const alignment =
		symbol.textAlignments?.[source] ?? symbol.textAlignments?.name;
	const attributeOverride =
		symbol.childOverrides?.[`attribute:${source}`] ??
		symbol.childOverrides?.["attribute:name"];
	return {
		...symbol,
		attributes: { name, reference: "", value: "" },
		texts: [{ ...label, attribute: "name" }],
		textPositions: position ? { name: position } : undefined,
		textAlignments: alignment ? { name: alignment } : undefined,
		childOverrides: symbol.childOverrides
			? {
					...Object.fromEntries(
						Object.entries(symbol.childOverrides).filter(
							([key]) => !key.startsWith("attribute:"),
						),
					),
					...(attributeOverride ? { "attribute:name": attributeOverride } : {}),
				}
			: undefined,
	};
}

export type SymbolChildOverride = Partial<
	Point &
		TextAlignment & {
			width: number;
			height: number;
			rotation: number;
			lineWidth: number;
			lineStyle: LineStyle;
			fontSize: number;
			text: string;
			name: string;
			number: string;
			showLabels: boolean;
			showName: boolean;
			showNumber: boolean;
			length: number;
			locked: boolean;
		}
>;

export interface SymbolChild {
	key: string;
	shape: SymbolShape;
}

export function isBoxSymbol(
	shape: EditorShape,
): shape is EditorSymbol & { definitionId: "box" } {
	return (
		shape.kind === "symbol" &&
		shape.definitionId === "box" &&
		(!shape.library ||
			(shape.library.scope === "user" && shape.library.id === "builtin"))
	);
}

export function boxBorder(
	symbol: EditorSymbol,
): { key: string; shape: BasicShape } | undefined {
	if (!isBoxSymbol(symbol)) return;
	const original = symbol.children.find((child) => child.kind === "rectangle");
	if (!original || original.kind !== "rectangle") return;
	const key = `shape:${original.id}`;
	return { key, shape: { ...original, ...symbol.childOverrides?.[key] } };
}

export function boxText(
	symbol: EditorSymbol,
): { key: string; shape: TextShape } | undefined {
	if (!isBoxSymbol(symbol)) return;
	const child = symbolChildren(symbol).find(
		(item) => item.shape.kind === "text",
	);
	return child?.shape.kind === "text"
		? { key: child.key, shape: child.shape }
		: undefined;
}

export function fitBoxToBorder(
	symbol: EditorSymbol,
	{
		preserveChildWorldPositions = false,
	}: { preserveChildWorldPositions?: boolean } = {},
): EditorSymbol {
	const border = boxBorder(symbol);
	if (!border) return symbol;
	const { width, height } = border.shape;
	const dx = border.shape.x - width / 2;
	const dy = border.shape.y + height / 2;
	if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 && border.shape.rotation === 0)
		return symbol.width === width && symbol.height === height
			? symbol
			: { ...symbol, width, height };
	const childOverrides = { ...symbol.childOverrides };
	for (const child of symbolChildren(symbol)) {
		if (child.key === border.key) {
			childOverrides[child.key] = {
				...childOverrides[child.key],
				x: width / 2,
				y: -height / 2,
				rotation: 0,
			};
		} else if (preserveChildWorldPositions && child.key.startsWith("shape:")) {
			childOverrides[child.key] = {
				...childOverrides[child.key],
				x: child.shape.x - dx,
				y: child.shape.y - dy,
			};
		}
	}
	return {
		...symbol,
		...localToWorld(symbol, dx, dy),
		width,
		height,
		childOverrides,
	};
}

export function shapeCenter(shape: EditorShape): Point {
	if (shape.kind === "text") return textCenter(shape);
	if (isBoxSymbol(shape))
		return localToWorld(shape, shape.width / 2, -shape.height / 2);
	return { x: shape.x, y: shape.y };
}

export function canSelectShape(
	shape: EditorShape,
	allowLocked = false,
): boolean {
	return allowLocked || !shape.locked;
}

export function canSelectSymbolChild(
	symbol: EditorSymbol,
	child: SymbolChild,
	allowLocked = false,
): boolean {
	if (boxBorder(symbol)?.key === child.key) return false;
	return (
		canSelectShape(symbol, allowLocked) &&
		!(child.shape.locked ?? child.shape.kind !== "text")
	);
}

export function symbolChildren(symbol: EditorSymbol): SymbolChild[] {
	return [
		...symbol.children.map((shape) => ({
			key: `shape:${shape.id}`,
			shape: {
				...shape,
				...symbol.childOverrides?.[`shape:${shape.id}`],
				locked:
					symbol.childOverrides?.[`shape:${shape.id}`]?.locked ??
					shape.locked ??
					shape.kind !== "text",
			} as SymbolShape,
		})),
		...symbolTextShapes({ ...symbol, x: 0, y: 0, rotation: 0 }).map(
			(shape) => ({
				key: `attribute:${symbol.texts[shape.id].attribute}`,
				shape,
			}),
		),
	];
}

export function symbolChildWorld(
	symbol: EditorSymbol,
	child: SymbolShape,
): SymbolShape {
	return {
		...child,
		...localToWorld(symbol, child.x, child.y),
		rotation: child.rotation + symbol.rotation,
	};
}

export function replaceSymbolChild(
	symbol: EditorSymbol,
	key: string,
	child: SymbolShape,
): EditorSymbol {
	const original = symbolChildren(symbol).find(
		(item) => item.key === key,
	)?.shape;
	if (!original || child.kind !== original.kind) return symbol;
	if (
		boxBorder(symbol)?.key === key &&
		child.width === original.width &&
		child.height === original.height
	) {
		const dx = child.x - original.x;
		const dy = child.y - original.y;
		if (dx || dy) {
			symbol = { ...symbol, ...localToWorld(symbol, dx, dy) };
			child = { ...child, x: original.x, y: original.y };
		}
	}
	const { id: _id, kind: _kind, ...values } = child;
	if (
		key.startsWith("attribute:") &&
		child.kind === "text" &&
		original.kind === "text"
	) {
		const attribute = key.slice(10) as SymbolText["attribute"];
		const { x, y, text, horizontalAlign, verticalAlign, ...appearance } =
			values as Omit<TextShape, "id" | "kind">;
		const changes = Object.fromEntries(
			Object.entries(appearance).filter(
				([field, value]) => value !== original[field as keyof TextShape],
			),
		);
		return {
			...symbol,
			...(text === original.text
				? {}
				: { attributes: { ...symbol.attributes, [attribute]: text } }),
			textPositions: { ...symbol.textPositions, [attribute]: { x, y } },
			...(horizontalAlign === original.horizontalAlign &&
			verticalAlign === original.verticalAlign
				? {}
				: {
						textAlignments: {
							...symbol.textAlignments,
							[attribute]: { horizontalAlign, verticalAlign },
						},
					}),
			...(Object.keys(changes).length
				? {
						childOverrides: {
							...symbol.childOverrides,
							[key]: { ...symbol.childOverrides?.[key], ...changes },
						},
					}
				: {}),
		};
	}

	const changes = Object.fromEntries(
		Object.entries(values).filter(
			([field, value]) => value !== original[field as keyof SymbolShape],
		),
	);
	return fitBoxToBorder({
		...symbol,
		childOverrides: {
			...symbol.childOverrides,
			[key]: { ...symbol.childOverrides?.[key], ...changes },
		},
	});
}

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

export interface SymbolText extends Point, TextAlignment {
	locked?: boolean;
	attribute: keyof EditorSymbol["attributes"];
	fontSize: number;
}

export function symbolTextPosition(
	symbol: EditorSymbol,
	label: SymbolText,
): Point {
	return symbol.textPositions?.[label.attribute] ?? label;
}

export function moveSymbolText(
	symbol: EditorSymbol,
	index: number,
	delta: Point,
	gridStep = 0,
): EditorSymbol {
	const label = symbol.texts[index];
	return label
		? moveSymbolChild(symbol, `attribute:${label.attribute}`, delta, gridStep)
		: symbol;
}

export interface TextShape extends ShapeGeometry, TextAlignment {
	circuitNet?: { id: string; label: string; pinId?: string };
	electrical?: "net" | "supply";
	kind: "text";
	text: string;
	fontSize: number;
	bold?: boolean;
}

export type SymbolShape = PrimitiveShape | TextShape;
export type EditorShape = SymbolShape | EditorSymbol;

export function isBasicShape(shape: EditorShape): shape is BasicShape {
	return (
		shape.kind === "rectangle" ||
		shape.kind === "circle" ||
		shape.kind === "triangle" ||
		shape.kind === "no-connect" ||
		shape.kind === "line"
	);
}

export function symbolShapes(symbol: EditorSymbol): SymbolShape[] {
	return symbol.children.map((original) => {
		const child = {
			...original,
			...symbol.childOverrides?.[`shape:${original.id}`],
		} as SymbolShape;
		return {
			...child,
			...(symbol.locked ? { locked: true } : {}),
			...localToWorld(symbol, child.x, child.y),
			rotation: child.rotation + symbol.rotation,
		};
	});
}

export function symbolTextShapes(symbol: EditorSymbol): TextShape[] {
	return symbol.texts.flatMap((label, index) => {
		const override = symbol.childOverrides?.[`attribute:${label.attribute}`];
		const fontSize = override?.fontSize ?? label.fontSize;
		const text = symbol.attributes[label.attribute];
		if (!text) return [];
		const position = symbolTextPosition(symbol, label);
		const lines = text
			.replace(/\r\n?/g, "\n")
			.replace(/\t/g, "    ")
			.split("\n");
		const width = Math.max(
			fontSize / 2,
			...lines.map((line) => line.length * fontSize * 0.6),
		);
		return [
			{
				id: index,
				kind: "text",
				...((override?.locked ?? label.locked) === undefined
					? {}
					: { locked: override?.locked ?? label.locked }),
				...localToWorld(symbol, position.x, position.y),
				width,
				height: lines.length * fontSize * 1.5,
				rotation: symbol.rotation + (override?.rotation ?? 0),
				lineWidth: 0,
				fontSize: fontSize,
				horizontalAlign:
					symbol.textAlignments?.[label.attribute]?.horizontalAlign ??
					label.horizontalAlign,
				verticalAlign:
					symbol.textAlignments?.[label.attribute]?.verticalAlign ??
					label.verticalAlign,
				text,
			},
		];
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

/** Dimension edits keep the center fixed; circles always retain equal diameters. */
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

export function snapCoordinate(value: number, step: number): number {
	return step > 0
		? Number((Math.round(value / step) * step).toPrecision(12))
		: value;
}

export function snapPoint(point: Point, step: number): Point {
	return { x: snapCoordinate(point.x, step), y: snapCoordinate(point.y, step) };
}

/** Keep the start fixed and project the snapped endpoint onto its nearest axis. */
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

function localToWorld(shape: EditorShape, x: number, y: number): Point {
	return {
		x: shape.x + x * Math.cos(shape.rotation) - y * Math.sin(shape.rotation),
		y: shape.y + x * Math.sin(shape.rotation) + y * Math.cos(shape.rotation),
	};
}

/** Handle positions use the same local axes as the rendered shape. */
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

/** Resize from the initial shape so a drag never accumulates rounding errors. */
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

/** Rectangles and triangles use opposite corners; circles use center/radius; lines and wires use endpoints. */
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
	if (
		shape.kind === "symbol" &&
		[...symbolTextShapes(shape), ...symbolShapes(shape)].some((text) =>
			hitShape(text, point, tolerance),
		)
	)
		return true;
	const { width, height } =
		shape.kind === "symbol" ? selectionSize(shape) : shape;
	const center = shapeCenter(shape);
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

/** Window selection includes a symbol only when its body and labels fit. */
export function containsSelection(shape: EditorShape, bounds: Bounds): boolean {
	if (
		shape.kind === "symbol" &&
		![...symbolTextShapes(shape), ...symbolShapes(shape)].every((child) =>
			containsSelection(child, bounds),
		)
	)
		return false;
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

/** Select any shape touched by the rectangle, including partially covered shapes. */
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
					...selectionSize(shape),
					...shapeCenter(shape),
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

/**
 * Distance within which two points form one electrical connection. Pointer-to-world
 * conversion can leave roughly 0.00001 mm after a visual collapse.
 */
export const connectionTolerance = 1e-4;
const normalizationTolerance = connectionTolerance;

// Connection lookups scan nearby buckets instead of every shape. A bucket is far
// wider than the connection tolerance, so the neighboring buckets hold every
// candidate and callers still apply the exact test.
const bucketOf = (value: number) => Math.floor(value);

/** Finds items whose point lies within one bucket of a query point. */
function createPointIndex<T>(items: readonly T[], pointOf: (item: T) => Point) {
	const buckets = new Map<number, Map<number, T[]>>();
	for (const item of items) {
		const point = pointOf(item);
		const x = bucketOf(point.x);
		const y = bucketOf(point.y);
		let column = buckets.get(x);
		if (!column) {
			column = new Map();
			buckets.set(x, column);
		}
		const entries = column.get(y);
		if (entries) entries.push(item);
		else column.set(y, [item]);
	}
	return (point: Point, test: (item: T) => boolean) => {
		const x = bucketOf(point.x);
		const y = bucketOf(point.y);
		for (let dx = -1; dx <= 1; dx++) {
			const column = buckets.get(x + dx);
			if (!column) continue;
			for (let dy = -1; dy <= 1; dy++)
				if (column.get(y + dy)?.some(test)) return true;
		}
		return false;
	};
}

/** Finds wires that `pointOnWire` could accept: those on the point's row or column. */
function createWireIndex<T extends { start: Point; end: Point }>(
	wires: readonly T[],
) {
	const rows = new Map<number, T[]>();
	const columns = new Map<number, T[]>();
	for (const wire of wires) {
		const vertical =
			Math.abs(wire.end.x - wire.start.x) < Math.abs(wire.end.y - wire.start.y);
		const index = vertical ? columns : rows;
		const key = bucketOf(vertical ? wire.start.x : wire.start.y);
		const entries = index.get(key);
		if (entries) entries.push(wire);
		else index.set(key, [wire]);
	}
	return (point: Point, test: (wire: T) => boolean) => {
		for (const [index, value] of [
			[rows, point.y],
			[columns, point.x],
		] as const) {
			const key = bucketOf(value);
			for (let offset = -1; offset <= 1; offset++)
				if (index.get(key + offset)?.some(test)) return true;
		}
		return false;
	};
}

// Shapes are immutable, so a drag reuses the terminals of every symbol it did not
// move. Frozen results keep the shared entries from being changed by a caller.
const symbolTerminals = new WeakMap<EditorShape, readonly Point[]>();

/** A pin has one terminal at its center, including pins inside rotated symbols. */
export function pinTerminals(shape: EditorShape): readonly Point[] {
	if (shape.kind === "pin") return [{ x: shape.x, y: shape.y }];
	if (shape.kind !== "symbol") return [];
	let terminals = symbolTerminals.get(shape);
	if (!terminals) {
		terminals = Object.freeze(
			symbolShapes(shape)
				.flatMap(pinTerminals)
				.map((point) => Object.freeze(point)),
		);
		symbolTerminals.set(shape, terminals);
	}
	return terminals;
}

/** Free pins include symbol terminals and exclude connections along wire interiors. */
export function openPins(
	shapes: EditorShape[],
	near?: { point: Point; tolerance: number },
) {
	const pins = shapes.flatMap((shape) =>
		pinTerminals(shape).map((point) => ({ shape, point })),
	);
	// Check connectivity only for pins within the pointer's hit area.
	const candidates = near
		? pins.filter(
				({ point }) =>
					Math.hypot(point.x - near.point.x, point.y - near.point.y) <=
					near.tolerance,
			)
		: pins;
	if (candidates.length === 0) return [];
	const onWire = createWireIndex(
		shapes
			.filter((shape) => shape.kind === "wire")
			.map((shape) => ({
				start: localToWorld(shape, -shape.width / 2, 0),
				end: localToWorld(shape, shape.width / 2, 0),
			})),
	);
	const nearNoConnect = createPointIndex(
		shapes.flatMap((shape) =>
			shape.kind === "symbol"
				? symbolShapes(shape).filter((child) => child.kind === "no-connect")
				: shape.kind === "no-connect"
					? [shape]
					: [],
		),
		(shape) => shape,
	);
	const nearPin = createPointIndex(pins, ({ point }) => point);
	return candidates.filter(
		(pin) =>
			!nearNoConnect(
				pin.point,
				(shape) =>
					Math.hypot(shape.x - pin.point.x, shape.y - pin.point.y) <=
					connectionTolerance,
			) &&
			!onWire(pin.point, ({ start, end }) =>
				pointOnWire(pin.point, start, end),
			) &&
			!nearPin(
				pin.point,
				(other) =>
					other !== pin &&
					Math.hypot(
						other.point.x - pin.point.x,
						other.point.y - pin.point.y,
					) <= connectionTolerance,
			),
	);
}

export function netLabelAnchors(shapes: EditorShape[]): Point[] {
	return shapes
		.filter(
			(shape) => shape.kind === "text" && shape.electrical && shape.text.trim(),
		)
		.map((shape) => ({ x: shape.x, y: shape.y }));
}

export function openWireEnds(shapes: EditorShape[]) {
	const nearPin = createPointIndex(
		[...shapes.flatMap(pinTerminals), ...netLabelAnchors(shapes)],
		(pin) => pin,
	);
	const wires = shapes
		.filter((shape) => shape.kind === "wire")
		.map((shape) => ({
			shape,
			start: localToWorld(shape, -shape.width / 2, 0),
			end: localToWorld(shape, shape.width / 2, 0),
		}));
	const onWire = createWireIndex(wires);
	return wires.flatMap((wire) =>
		[wire.start, wire.end]
			.filter(
				(point) =>
					!nearPin(
						point,
						(pin) =>
							Math.hypot(pin.x - point.x, pin.y - point.y) <=
							connectionTolerance,
					) &&
					!onWire(
						point,
						(other) =>
							other !== wire && pointOnWire(point, other.start, other.end),
					),
			)
			.map((point) => ({ shape: wire.shape, point })),
	);
}

export function wireConnectionPoints(shapes: EditorShape[]): Point[] {
	return [
		...shapes.flatMap(pinTerminals),
		...netLabelAnchors(shapes),
		...openWireEnds(shapes).map(({ point }) => point),
	];
}

export function wireJunctions(shapes: EditorShape[]) {
	const wires = shapes.flatMap((shape) => {
		if (shape.kind !== "wire" || shape.width <= connectionTolerance) return [];
		const start = localToWorld(shape, -shape.width / 2, 0);
		const end = localToWorld(shape, shape.width / 2, 0);
		return [{ shape, start, end }];
	});
	const axes = [
		new Map<number, typeof wires>(),
		new Map<number, typeof wires>(),
	];
	const bucket = (value: number) => Math.floor(value / connectionTolerance);
	for (const wire of wires) {
		const vertical =
			Math.abs(wire.end.x - wire.start.x) < Math.abs(wire.end.y - wire.start.y);
		const index = axes[vertical ? 0 : 1];
		const key = bucket(vertical ? wire.start.x : wire.start.y);
		const entries = index.get(key) ?? [];
		entries.push(wire);
		index.set(key, entries);
	}
	type Candidate = { point: Point; pins: EditorShape[] };
	const candidates = new Map<number, Map<number, Candidate[]>>();
	// Buckets in creation order, so results keep a stable document-derived order.
	const buckets: Candidate[][] = [];
	const atPoint = (point: Point) => {
		const x = bucket(point.x);
		const y = bucket(point.y);
		for (let dx = -1; dx <= 1; dx++) {
			const column = candidates.get(x + dx);
			if (!column) continue;
			for (let dy = -1; dy <= 1; dy++) {
				const existing = column
					.get(y + dy)
					?.find(
						(candidate) =>
							Math.hypot(
								candidate.point.x - point.x,
								candidate.point.y - point.y,
							) <= connectionTolerance,
					);
				if (existing) return existing;
			}
		}
		const candidate = { point, pins: [] as EditorShape[] };
		let column = candidates.get(x);
		if (!column) {
			column = new Map();
			candidates.set(x, column);
		}
		let entries = column.get(y);
		if (!entries) {
			entries = [];
			column.set(y, entries);
			buckets.push(entries);
		}
		entries.push(candidate);
		return candidate;
	};
	for (const shape of shapes) {
		for (const point of pinTerminals(shape)) atPoint(point).pins.push(shape);
	}
	for (const { start, end } of wires) {
		atPoint(start);
		atPoint(end);
	}
	return buckets.flat().flatMap(({ point, pins }) => {
		let branches = pins.length;
		const connected = [...pins];
		for (const [axis, coordinate] of [point.x, point.y].entries()) {
			const key = bucket(coordinate);
			for (let offset = -1; offset <= 1; offset++) {
				for (const wire of axes[axis].get(key + offset) ?? []) {
					if (!pointOnWire(point, wire.start, wire.end)) continue;
					const atEnd = [wire.start, wire.end].some(
						(end) =>
							Math.hypot(end.x - point.x, end.y - point.y) <=
							connectionTolerance,
					);
					branches += atEnd ? 1 : 2;
					connected.push(wire.shape);
				}
			}
		}
		return branches >= 3 ? [{ point, shapes: connected }] : [];
	});
}

/** Resolve against the pointer before grid snapping so off-grid pins stay exact. */
export function findWireConnection(
	shapes: EditorShape[],
	point: Point,
	tolerance: number,
	start?: Point,
): Point | undefined {
	let nearest: Point | undefined;
	let distance = tolerance;
	const wires = shapes
		.filter(
			(shape) => shape.kind === "wire" && shape.width > connectionTolerance,
		)
		.map((shape) => ({
			shape,
			start: localToWorld(shape, -shape.width / 2, 0),
			end: localToWorld(shape, shape.width / 2, 0),
		}));
	const consider = (candidate: Point) => {
		if (
			start &&
			Math.hypot(candidate.x - start.x, candidate.y - start.y) <=
				connectionTolerance
		)
			return;
		const next = Math.hypot(candidate.x - point.x, candidate.y - point.y);
		if (next <= distance) {
			nearest = candidate;
			distance = next;
		}
	};
	// Prefer exact terminals and existing junctions before projecting onto a segment.
	for (const candidate of [
		...shapes.flatMap(pinTerminals),
		...netLabelAnchors(shapes),
		...wires.flatMap(({ start, end }) => [start, end]),
	])
		consider(candidate);
	if (nearest) return nearest;
	for (const wire of wires) {
		const vertical =
			Math.abs(wire.end.x - wire.start.x) < Math.abs(wire.end.y - wire.start.y);
		const along = vertical ? "y" : "x";
		const across = vertical ? "x" : "y";
		const candidate = { ...point, [across]: wire.shape[across] };
		candidate[along] = Math.max(
			Math.min(wire.start[along], wire.end[along]),
			Math.min(candidate[along], Math.max(wire.start[along], wire.end[along])),
		);
		consider(candidate);
	}
	return nearest;
}

/** Reach an exact terminal with an orthogonal bend when both coordinates differ. */
export function routeWire(
	id: number,
	start: Point,
	end: Point,
	horizontalFirst = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y),
): PrimitiveShape[] {
	if (
		Math.abs(end.x - start.x) <= connectionTolerance ||
		Math.abs(end.y - start.y) <= connectionTolerance
	)
		return [drawShape(id, "wire", start, end)];
	const corner = horizontalFirst
		? { x: end.x, y: start.y }
		: { x: start.x, y: end.y };
	return [
		drawShape(id, "wire", start, corner),
		drawShape(id + 1, "wire", corner, end),
	];
}

/** Normalize committed segments; drag previews keep their original separate IDs. */
export function normalizeWireSegments(
	shapes: EditorShape[],
	preferredIds: ReadonlySet<number> = new Set(),
	nextShapeId = shapes.reduce(
		(maximum, shape) => Math.max(maximum, shape.id),
		0,
	) + 1,
): {
	shapes: EditorShape[];
	idMap: Map<number, number>;
	idsBySource: Map<number, number[]>;
	nextShapeId: number;
} {
	const wires = shapes.flatMap((shape, index) => {
		if (shape.kind !== "wire" || shape.width <= normalizationTolerance)
			return [];
		const start = localToWorld(shape, -shape.width / 2, 0);
		const end = localToWorld(shape, shape.width / 2, 0);
		const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
		return [
			{
				shape,
				index,
				vertical,
				coordinate: vertical ? shape.x : shape.y,
				min: Math.min(vertical ? start.y : start.x, vertical ? end.y : end.x),
				max: Math.max(vertical ? start.y : start.x, vertical ? end.y : end.x),
				forward: vertical ? end.y >= start.y : end.x >= start.x,
			},
		];
	});
	const sets = unionFind(wires.length);
	const junctions: Point[] = shapes.flatMap(pinTerminals);
	for (let first = 0; first < wires.length; first++) {
		for (let second = first + 1; second < wires.length; second++) {
			const a = wires[first];
			const b = wires[second];
			if (a.vertical !== b.vertical) {
				const horizontal = a.vertical ? b : a;
				const vertical = a.vertical ? a : b;
				const x = vertical.coordinate;
				const y = horizontal.coordinate;
				if (
					x >= horizontal.min - normalizationTolerance &&
					x <= horizontal.max + normalizationTolerance &&
					y >= vertical.min - normalizationTolerance &&
					y <= vertical.max + normalizationTolerance &&
					(Math.abs(x - horizontal.min) <= normalizationTolerance ||
						Math.abs(x - horizontal.max) <= normalizationTolerance ||
						Math.abs(y - vertical.min) <= normalizationTolerance ||
						Math.abs(y - vertical.max) <= normalizationTolerance)
				)
					junctions.push({ x, y });
			}
			if (
				a.vertical === b.vertical &&
				a.shape.lineWidth === b.shape.lineWidth &&
				(a.shape.locked ?? false) === (b.shape.locked ?? false) &&
				Math.abs(a.coordinate - b.coordinate) <= normalizationTolerance &&
				a.min <= b.max + normalizationTolerance &&
				b.min <= a.max + normalizationTolerance
			)
				sets.union(second, first);
		}
	}
	const clusters = new Map<number, typeof wires>();
	for (const [index, wire] of wires.entries()) {
		const key = sets.find(index);
		const cluster = clusters.get(key) ?? [];
		cluster.push(wire);
		clusters.set(key, cluster);
	}
	const replacements = new Map<number, EditorShape[]>();
	const idMap = new Map<number, number>();
	const idsBySource = new Map<number, number[]>();
	for (const cluster of clusters.values()) {
		const survivor =
			cluster.find(({ shape }) => preferredIds.has(shape.id)) ?? cluster[0];
		const min = Math.min(...cluster.map((wire) => wire.min));
		const max = Math.max(...cluster.map((wire) => wire.max));
		// Pin terminals and wire endpoints create junctions. Bare crossings stay separate.
		const cuts = junctions
			.flatMap((point) => {
				const along = survivor.vertical ? point.y : point.x;
				const across = survivor.vertical ? point.x : point.y;
				return Math.abs(across - survivor.coordinate) <=
					normalizationTolerance &&
					along > min + normalizationTolerance &&
					along < max - normalizationTolerance
					? [along]
					: [];
			})
			.sort((a, b) => a - b)
			.filter(
				(value, index, values) =>
					index === 0 || value - values[index - 1] > normalizationTolerance,
			);
		if (cluster.length === 1 && cuts.length === 0) {
			idMap.set(survivor.shape.id, survivor.shape.id);
			idsBySource.set(survivor.shape.id, [survivor.shape.id]);
			replacements.set(cluster[0].index, [survivor.shape]);
			continue;
		}
		const point = (value: number): Point =>
			survivor.vertical
				? { x: survivor.coordinate, y: value }
				: { x: value, y: survivor.coordinate };
		const boundaries = [min, ...cuts, max];
		if (!survivor.forward) boundaries.reverse();
		const usedIds = new Set<number>();
		const segments = boundaries.slice(1).map((end, index) => {
			const start = boundaries[index];
			const sources = cluster.filter(
				(wire) =>
					Math.min(wire.max, Math.max(start, end)) -
						Math.max(wire.min, Math.min(start, end)) >
					normalizationTolerance,
			);
			const available = sources.filter(({ shape }) => !usedIds.has(shape.id));
			const source =
				available.find(({ shape }) => preferredIds.has(shape.id)) ??
				available[0];
			const id = source?.shape.id ?? nextShapeId++;
			usedIds.add(id);
			for (const { shape } of sources) {
				if (!idMap.has(shape.id)) idMap.set(shape.id, id);
				const ids = idsBySource.get(shape.id) ?? [];
				ids.push(id);
				idsBySource.set(shape.id, ids);
			}
			// Repeated commits must not rewrite untouched pieces through endpoint rounding.
			if (
				source &&
				source.forward === survivor.forward &&
				Math.abs(source.coordinate - survivor.coordinate) <= 1e-9 &&
				Math.abs(source.min - Math.min(start, end)) <= 1e-9 &&
				Math.abs(source.max - Math.max(start, end)) <= 1e-9
			)
				return source.shape;
			return {
				...drawShape(id, "wire", point(start), point(end)),
				...(survivor.shape.locked === undefined
					? {}
					: { locked: survivor.shape.locked }),
				lineWidth: survivor.shape.lineWidth,
			};
		});
		// Keep retained source IDs mapped to themselves, even if they span several pieces.
		for (const { id } of segments)
			if (cluster.some(({ shape }) => shape.id === id)) idMap.set(id, id);
		replacements.set(cluster[0].index, segments);
	}
	return {
		shapes: shapes.flatMap((shape, index) => {
			if (shape.kind !== "wire") {
				idMap.set(shape.id, shape.id);
				idsBySource.set(shape.id, [shape.id]);
				return [shape];
			}
			const replacement = replacements.get(index);
			return replacement ?? [];
		}),
		idMap,
		idsBySource,
		nextShapeId,
	};
}

function pointOnWire(point: Point, start: Point, end: Point) {
	// Named axes keep this hot connection test free of keyed property lookups.
	if (Math.abs(end.x - start.x) < Math.abs(end.y - start.y))
		return (
			Math.abs(point.x - start.x) <= connectionTolerance &&
			point.y >= Math.min(start.y, end.y) - connectionTolerance &&
			point.y <= Math.max(start.y, end.y) + connectionTolerance
		);
	return (
		Math.abs(point.y - start.y) <= connectionTolerance &&
		point.x >= Math.min(start.x, end.x) - connectionTolerance &&
		point.x <= Math.max(start.x, end.x) + connectionTolerance
	);
}

/** Preserve endpoint junctions using the drawing as it was when movement began. */
function moveConnectedWires(
	selected: EditorShape[],
	delta: Point,
	allShapes: EditorShape[],
): EditorShape[] {
	const selectedIds = new Set(selected.map((shape) => shape.id));
	const originals = new Map(allShapes.map((shape) => [shape.id, shape]));
	for (const shape of selected) originals.set(shape.id, shape);
	const wires = [...originals.values()]
		.filter((shape) => shape.kind === "wire")
		.map((shape) => ({
			shape,
			start: localToWorld(shape, -shape.width / 2, 0),
			end: localToWorld(shape, shape.width / 2, 0),
		}));
	const points = wires.flatMap(({ start, end }) => [start, end]);
	const connections = {
		x: points.map(() => new Set<number>()),
		y: points.map(() => new Set<number>()),
	};
	const connect = (axis: "x" | "y", first: number, second: number) => {
		connections[axis][first].add(second);
		connections[axis][second].add(first);
	};
	const seeds = new Set<number>();
	const attachments: { point: number; wire: number }[] = [];
	for (let first = 0; first < points.length; first++) {
		for (let second = first + 1; second < points.length; second++) {
			if (
				Math.hypot(
					points[first].x - points[second].x,
					points[first].y - points[second].y,
				) <= connectionTolerance
			) {
				connect("x", first, second);
				connect("y", first, second);
			}
		}
	}
	for (const [index, wire] of wires.entries()) {
		const first = index * 2;
		const second = first + 1;
		const axis =
			Math.abs(wire.end.x - wire.start.x) < Math.abs(wire.end.y - wire.start.y)
				? "x"
				: "y";
		connect(axis, first, second);
		const selectedWire = selectedIds.has(wire.shape.id);
		if (selectedWire) {
			seeds.add(first);
			seeds.add(second);
		}
		for (const [pointIndex, point] of points.entries()) {
			if (Math.floor(pointIndex / 2) === index) continue;
			if (!pointOnWire(point, wire.start, wire.end)) continue;
			attachments.push({ point: pointIndex, wire: index });
			// A T junction shares the coordinate perpendicular to the wire.
			connect(axis, first, pointIndex);
			connect(axis, second, pointIndex);
			// Attachments on a translated selected segment follow it in both axes.
			if (selectedWire) seeds.add(pointIndex);
		}
	}
	const reachable = (axis: "x" | "y") => {
		const reached = new Set(seeds);
		const pending = [...seeds];
		for (let index = 0; index < pending.length; index++) {
			for (const next of connections[axis][pending[index]]) {
				if (reached.has(next)) continue;
				reached.add(next);
				pending.push(next);
			}
		}
		return reached;
	};
	const moveX = reachable("x");
	const moveY = reachable("y");
	const affected = wires.filter((_, index) =>
		[index * 2, index * 2 + 1].some(
			(point) => moveX.has(point) || moveY.has(point),
		),
	);
	const replacements = [
		...selected,
		...affected
			.filter(({ shape }) => !selectedIds.has(shape.id))
			.map(({ shape }) => shape),
	];
	// Include unchanged neighbors so reversing a drag restores their original ends.
	if (delta.x === 0 && delta.y === 0) return replacements;
	const moved = points.map((point, index) => ({
		x: point.x + (moveX.has(index) ? delta.x : 0),
		y: point.y + (moveY.has(index) ? delta.y : 0),
	}));
	// Sliding a T junction is allowed while it remains on its attached segment.
	if (
		attachments.some(
			({ point, wire }) =>
				!pointOnWire(moved[point], moved[wire * 2], moved[wire * 2 + 1]),
		)
	)
		return replacements;
	const updated = new Map<number, EditorShape>();
	for (const [index, wire] of wires.entries()) {
		const start = moved[index * 2];
		const end = moved[index * 2 + 1];
		if (
			start.x === wire.start.x &&
			start.y === wire.start.y &&
			end.x === wire.end.x &&
			end.y === wire.end.y
		)
			continue;
		updated.set(wire.shape.id, {
			...drawShape(wire.shape.id, "wire", start, end),
			lineWidth: wire.shape.lineWidth,
		});
	}
	return replacements.map((shape) =>
		shape.kind === "wire"
			? (updated.get(shape.id) ?? shape)
			: { ...shape, x: shape.x + delta.x, y: shape.y + delta.y },
	);
}

function movementTerminals(shape: EditorShape): readonly Point[] {
	if (shape.kind === "text" && shape.electrical && shape.text.trim())
		return [{ x: shape.x, y: shape.y }];
	return pinTerminals(shape);
}

export function moveShapes(
	shapes: EditorShape[],
	delta: Point,
	gridStep = 0,
	anchorShape = shapes[0],
	allShapes = shapes,
	nextShapeId = [...allShapes, ...shapes].reduce(
		(maximum, shape) => Math.max(maximum, shape.id),
		0,
	) + 1,
	allowLocked = false,
): EditorShape[] {
	if (!allowLocked && shapes.some((shape) => shape.locked)) return shapes;
	if (gridStep > 0 && anchorShape) {
		// Keep corners on the grid even when the center lies halfway between grid lines.
		const anchor =
			anchorShape.kind === "circle" ||
			anchorShape.kind === "symbol" ||
			anchorShape.kind === "pin" ||
			anchorShape.kind === "no-connect" ||
			anchorShape.kind === "text"
				? anchorShape
				: localToWorld(
						anchorShape,
						-anchorShape.width / 2,
						anchorShape.kind === "wire" || anchorShape.kind === "line"
							? 0
							: -anchorShape.height / 2,
					);
		const target = snapPoint(
			{ x: anchor.x + delta.x, y: anchor.y + delta.y },
			gridStep,
		);
		delta = { x: target.x - anchor.x, y: target.y - anchor.y };
	}
	const moved = shapes.some((shape) => shape.kind === "wire")
		? moveConnectedWires(shapes, delta, allShapes)
		: shapes.map((shape) => ({
				...shape,
				x: shape.x + delta.x,
				y: shape.y + delta.y,
			}));
	if (!allowLocked && allShapes.some((shape) => shape.locked)) {
		const originals = new Map(allShapes.map((shape) => [shape.id, shape]));
		if (
			moved.some((shape) => {
				const original = originals.get(shape.id);
				return (
					original?.locked &&
					["x", "y", "width", "height", "rotation"].some(
						(key) =>
							original[key as keyof EditorShape] !==
							shape[key as keyof EditorShape],
					)
				);
			})
		)
			return moved.map((shape) => originals.get(shape.id) ?? shape);
	}

	if (delta.x === 0 && delta.y === 0) return moved;
	return connectTransformedTerminals(shapes, moved, allShapes, nextShapeId);
}

export function connectTransformedTerminals(
	shapes: EditorShape[],
	replacements: EditorShape[],
	allShapes: EditorShape[],
	nextShapeId: number,
	rerouteWireEnds = false,
): EditorShape[] {
	const moved = [...replacements];
	const terminals = shapes.flatMap((shape) =>
		movementTerminals(shape).map((point) => ({ shape, point })),
	);
	if (terminals.length === 0) return moved;
	const selectedIds = new Set(shapes.map((shape) => shape.id));
	const byId = new Map(moved.map((shape) => [shape.id, shape]));
	const stationaryTerminals = allShapes
		.filter((shape) => !selectedIds.has(shape.id))
		.flatMap((shape) =>
			movementTerminals(shape).map((point) => ({ shape, point })),
		);
	const stationaryPins = stationaryTerminals.map(({ point }) => point);
	const wires = allShapes.filter((shape) => shape.kind === "wire");
	const targets = shapes.flatMap((shape) =>
		movementTerminals(byId.get(shape.id) ?? shape),
	);
	const wireJunctions = rerouteWireEnds
		? wires.flatMap((wire) => [
				localToWorld(wire, -wire.width / 2, 0),
				localToWorld(wire, wire.width / 2, 0),
			])
		: [];
	const connections: {
		shape: EditorShape;
		terminal: Point;
		target: Point;
		anchor: Point;
	}[] = [];
	for (const [index, { shape, point: terminal }] of terminals.entries()) {
		const target = targets[index];
		if (
			Math.hypot(target.x - terminal.x, target.y - terminal.y) <=
			connectionTolerance
		)
			continue;
		const anchors: Point[] = [];
		if (
			stationaryPins.some(
				(pin) =>
					Math.hypot(pin.x - terminal.x, pin.y - terminal.y) <=
					connectionTolerance,
			)
		)
			anchors.push(terminal);
		for (const original of wires) {
			const wire = rerouteWireEnds
				? (byId.get(original.id) ?? original)
				: original;
			if (wire.width <= connectionTolerance) continue;
			const start = localToWorld(wire, -wire.width / 2, 0);
			const end = localToWorld(wire, wire.width / 2, 0);
			if (!pointOnWire(terminal, start, end)) continue;
			if (
				rerouteWireEnds &&
				!wire.locked &&
				!selectedIds.has(wire.id) &&
				[start, end].some(
					(point) =>
						Math.hypot(point.x - terminal.x, point.y - terminal.y) <=
						connectionTolerance,
				)
			) {
				const endpoint =
					Math.hypot(start.x - terminal.x, start.y - terminal.y) <=
					connectionTolerance
						? end
						: start;
				const junction = [
					...stationaryPins,
					...terminals.map(({ point }) => point),
					...wireJunctions,
				].reduce((nearest, point) => {
					const distance = Math.hypot(
						point.x - terminal.x,
						point.y - terminal.y,
					);
					return distance > connectionTolerance &&
						distance <
							Math.hypot(nearest.x - terminal.x, nearest.y - terminal.y) &&
						pointOnWire(point, start, end)
						? point
						: nearest;
				}, endpoint);
				const other = terminals.findIndex(
					({ point }) =>
						Math.hypot(point.x - junction.x, point.y - junction.y) <=
						connectionTolerance,
				);
				const anchor = other < 0 ? junction : targets[other];
				const retained = {
					...wire,
					...drawShape(wire.id, "wire", junction, endpoint),
					lineWidth: wire.lineWidth,
				};
				const index = moved.findIndex((shape) => shape.id === wire.id);
				if (index < 0) moved.push(retained);
				else moved[index] = retained;
				byId.set(wire.id, retained);
				anchors.push(anchor);
				continue;
			}
			const replacement = byId.get(wire.id) ?? wire;
			const movedStart = localToWorld(replacement, -replacement.width / 2, 0);
			const movedEnd = localToWorld(replacement, replacement.width / 2, 0);
			if (pointOnWire(target, movedStart, movedEnd)) continue;
			const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
			const across = vertical ? "x" : "y";
			const along = vertical ? "y" : "x";
			const anchor = { ...terminal };
			anchor[across] = replacement[across];
			anchor[along] = Math.max(
				Math.min(movedStart[along], movedEnd[along]),
				Math.min(terminal[along], Math.max(movedStart[along], movedEnd[along])),
			);
			anchors.push(anchor);
		}
		const unique = anchors.filter(
			(anchor, index) =>
				!anchors
					.slice(0, index)
					.some(
						(other) =>
							Math.hypot(anchor.x - other.x, anchor.y - other.y) <=
							connectionTolerance,
					),
		);
		for (const anchor of unique) {
			if (
				Math.hypot(target.x - anchor.x, target.y - anchor.y) >
				connectionTolerance
			)
				connections.push({ shape, terminal, target, anchor });
		}
	}
	const obstacles = wires
		.map((wire) => byId.get(wire.id) ?? wire)
		.filter((wire) => wire.width > connectionTolerance);
	const nets =
		connections.length &&
		(rerouteWireEnds ||
			allShapes.some(
				(shape) =>
					(shape.kind === "text" && shape.electrical) ||
					(shape.kind === "symbol" && shape.netSymbol),
			))
			? electricalNets(allShapes)
			: [];
	const wireNets = new Map(
		nets.flatMap((net) => net.wires.map((id) => [id, net] as const)),
	);
	const labelNets = new Map(
		nets.flatMap((net) => net.labels.map((id) => [id, net] as const)),
	);
	const pinNets = new Map(
		nets.flatMap((net) =>
			net.pins.map((pin) => [`${pin.shapeId}:${pin.pinId}`, net] as const),
		),
	);
	const symbolPins = new Map(
		allShapes.flatMap((shape) =>
			shape.kind === "symbol"
				? [
						[
							shape.id,
							symbolShapes(shape).filter((child) => child.kind === "pin"),
						] as const,
					]
				: [],
		),
	);
	const memberships = new Map(
		[...terminals, ...stationaryTerminals].map(({ shape, point }) => {
			if (shape.kind === "text")
				return [point, labelNets.get(shape.id)] as const;
			const pinId =
				shape.kind === "pin"
					? shape.id
					: symbolPins
							.get(shape.id)
							?.find(
								(pin) =>
									Math.hypot(pin.x - point.x, pin.y - point.y) <=
									connectionTolerance,
							)?.id;
			return [
				point,
				pinId === undefined ? undefined : pinNets.get(`${shape.id}:${pinId}`),
			] as const;
		}),
	);
	const preserveLabeledNets = connections.some(
		({ terminal }) => memberships.get(terminal)?.names.length,
	);
	for (const { shape, terminal, target, anchor } of connections) {
		const net = memberships.get(terminal);
		const horizontalFirst =
			shape.kind !== "symbol"
				? undefined
				: Math.abs(terminal.x - shape.x) >= Math.abs(terminal.y - shape.y)
					? (terminal.x - shape.x) * (target.x - terminal.x) >= 0
					: (terminal.y - shape.y) * (target.y - terminal.y) < 0;
		const segments =
			rerouteWireEnds || preserveLabeledNets
				? routeTransformedConnection(
						nextShapeId,
						anchor,
						target,
						Math.max(shape.width, shape.height) + 1,
						horizontalFirst,
						[
							...stationaryPins.filter(
								(point) => !net || memberships.get(point) !== net,
							),
							...targets.filter(
								(_, index) =>
									!net || memberships.get(terminals[index].point) !== net,
							),
						],
						obstacles.filter((wire) => !net || wireNets.get(wire.id) !== net),
					)
				: routeWire(nextShapeId, anchor, target, horizontalFirst);
		if (!segments) return shapes;
		obstacles.push(...segments);
		if (net) for (const segment of segments) wireNets.set(segment.id, net);

		moved.push(...segments);
		nextShapeId += segments.length;
	}
	return moved;
}

function routeTransformedConnection(
	id: number,
	anchor: Point,
	target: Point,
	spacing: number,
	horizontalFirst: boolean | undefined,
	terminals: Point[],
	obstacles: EditorShape[],
): EditorShape[] | undefined {
	const allowed = (point: Point) =>
		[anchor, target].some(
			(end) =>
				Math.hypot(point.x - end.x, point.y - end.y) <= connectionTolerance,
		);
	const endpoints = (wire: EditorShape) => [
		localToWorld(wire, -wire.width / 2, 0),
		localToWorld(wire, wire.width / 2, 0),
	];
	const edges = obstacles.map(endpoints);
	const clear = (segments: EditorShape[]) =>
		segments.every((segment) => {
			const [start, end] = endpoints(segment);
			if (
				terminals.some(
					(point) => !allowed(point) && pointOnWire(point, start, end),
				)
			)
				return false;
			return edges.every(([a, b]) => {
				if (
					[a, b].some(
						(point) => !allowed(point) && pointOnWire(point, start, end),
					)
				)
					return false;
				if (
					[start, end].some(
						(point) => !allowed(point) && pointOnWire(point, a, b),
					)
				)
					return false;
				const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
				const across = vertical ? "x" : "y",
					along = vertical ? "y" : "x";
				return (
					Math.abs(a[across] - start[across]) > connectionTolerance ||
					Math.abs(b[across] - start[across]) > connectionTolerance ||
					Math.min(
						Math.max(start[along], end[along]),
						Math.max(a[along], b[along]),
					) -
						Math.max(
							Math.min(start[along], end[along]),
							Math.min(a[along], b[along]),
						) <=
						connectionTolerance
				);
			});
		});
	for (const horizontal of [horizontalFirst, !horizontalFirst]) {
		const direct = routeWire(id, anchor, target, horizontal);
		if (clear(direct)) return direct;
	}
	for (let lane = 1; lane <= 32; lane++)
		for (const sign of [1, -1]) {
			const y = target.y + sign * spacing * lane;
			const x = target.x + sign * spacing * lane;
			for (const points of [
				[anchor, { x: anchor.x, y }, { x: target.x, y }, target],
				[anchor, { x, y: anchor.y }, { x, y: target.y }, target],
			]) {
				const segments = points
					.slice(1)
					.map((point, index) =>
						drawShape(id + index, "wire", points[index], point),
					)
					.filter((wire) => wire.width > connectionTolerance);
				if (clear(segments))
					return segments.map((segment, index) => ({
						...segment,
						id: id + index,
					}));
			}
		}
}
