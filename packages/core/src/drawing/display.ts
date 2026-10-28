import type { LineStyle } from "#/drawing/line-style.ts";
import { type TextAlignment, textCenter } from "#/drawing/text-alignment.ts";
import {
	buildWireCrossings,
	type WireCrossings,
} from "#/drawing/wire-crossings.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import {
	drawShape,
	type EditorShape,
	isBasicShape,
	openPins,
	openWireEnds,
	PIN_RADIUS,
	type ShapeKind,
	selectionSize,
	shapeBounds,
	shapeCenter,
	symbolShapes,
	symbolTextPosition,
	symbolTextShapes,
	wireJunctions,
} from "./shapes";

interface GeometrySize {
	width: number;
	height: number;
	lineWidth: number;
	lineStyle?: LineStyle;
	filled?: boolean;
	length?: number;
}

export interface DrawingTransform {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
}

/** Geometry contains only the dimensions needed to draw an object. */
export type DrawingGeometry =
	| (GeometrySize & { kind: Exclude<ShapeKind, "wire"> })
	| (GeometrySize & { kind: "wire" } & Partial<WireCrossings>)
	| (GeometrySize & { kind: "pin-halo" })
	| (GeometrySize & {
			kind: "symbol";
			children: (GeometrySize & DrawingTransform & { kind: ShapeKind })[];
	  });

export type DrawingAppearance = "stroke" | "pin" | "wire" | "selected" | "fill";

export interface DisplayShape extends DrawingTransform, TextAlignment {
	key: string;
	name: string;
	geometry: DrawingGeometry;
	appearance: DrawingAppearance;
	text?: string;
	pinLabel?: true;
	renderOrder: number;
	children?: DisplayShape[];
}

export interface DisplaySelection extends DrawingTransform {
	shapeKey: string;
	renderOrder: number;
}

export interface DrawingDisplay {
	shapes: DisplayShape[];
	selections: DisplaySelection[];
	terminals: DisplayShape[];
	junctions: DisplayShape[];
	connections: DisplayShape[];
	halos: DisplayShape[];
	previews: DisplayShape[];
}

function geometryFor(shape: EditorShape): DrawingGeometry {
	const { kind, width, height, lineWidth } = shape;
	if (kind !== "symbol")
		return {
			kind,
			width,
			height,
			lineWidth,
			...(shape.kind === "pin" && shape.length !== undefined
				? { length: shape.length }
				: {}),
			...(isBasicShape(shape) && shape.lineStyle
				? { lineStyle: shape.lineStyle }
				: {}),
		};
	return {
		kind,
		width,
		height,
		lineWidth,
		children: symbolShapes({ ...shape, x: 0, y: 0, rotation: 0 })
			.filter(isBasicShape)
			.map((child) => ({
				...geometryFor(child),
				kind: child.kind,
				x: child.x,
				y: child.y,
				rotation: child.rotation,
			})),
	};
}

function uprightTextRotation(rotation: number): number {
	const angle = rotation % Math.PI;
	if (angle > Math.PI / 2) return angle - Math.PI;
	if (angle <= -Math.PI / 2) return angle + Math.PI;
	return angle;
}

function displayShape(
	shape: EditorShape,
	key: string,
	name: string,
	appearance: DrawingAppearance,
	renderOrder: number,
): DisplayShape {
	const display: DisplayShape = {
		key,
		name,
		geometry: geometryFor(shape),
		...(shape.kind === "text" ? textCenter(shape) : { x: shape.x, y: shape.y }),
		width: shape.width,
		height:
			shape.kind === "wire" || shape.kind === "line"
				? shape.lineWidth
				: shape.height,
		rotation:
			shape.kind === "text"
				? uprightTextRotation(shape.rotation)
				: shape.rotation,
		appearance,
		...(shape.kind === "text"
			? {
					text: shape.text,
					horizontalAlign: shape.horizontalAlign,
					verticalAlign: shape.verticalAlign,
				}
			: {}),
		renderOrder,
	};
	const fillChildren =
		shape.kind === "symbol" &&
		shape.children.some((child) => isBasicShape(child) && child.filled)
			? symbolShapes({ ...shape, x: 0, y: 0, rotation: 0 })
			: isBasicShape(shape) && shape.filled
				? [shape]
				: [];
	const fills = fillChildren
		.filter(
			(child) => isBasicShape(child) && child.filled && child.kind !== "line",
		)
		.map((child) => ({
			key: `${key}:fill:${child.id}`,
			name: `fill ${shape.id}:${child.id}`,
			geometry: {
				...geometryFor(child),
				filled: true,
				lineWidth: 0,
				lineStyle: undefined,
			},
			x: shape.kind === "symbol" ? child.x / shape.width : 0,
			y: shape.kind === "symbol" ? child.y / shape.height : 0,
			width: child.width / shape.width,
			height: child.height / shape.height,
			rotation: shape.kind === "symbol" ? child.rotation : 0,
			appearance: "fill" as const,
			renderOrder: renderOrder - 0.5,
		}));
	if (fills.length) display.children = fills;
	if (shape.kind === "symbol") {
		const labels = shape.texts
			.filter((label) => shape.attributes[label.attribute])
			.map((label) => ({ ...label, ...symbolTextPosition(shape, label) }));
		display.children = [
			...fills,
			...symbolTextShapes(shape).map((text, index) => ({
				...displayShape(
					text,
					`${key}:${labels[index].attribute}`,
					`${labels[index].attribute} ${shape.id}`,
					appearance,
					renderOrder + 1,
				),
				x:
					textCenter({
						...text,
						x: labels[index].x,
						y: labels[index].y,
						rotation: text.rotation - shape.rotation,
					}).x / shape.width,
				y:
					textCenter({
						...text,
						x: labels[index].x,
						y: labels[index].y,
						rotation: text.rotation - shape.rotation,
					}).y / shape.height,
				width: text.width / shape.width,
				height: text.height / shape.height,
				rotation: uprightTextRotation(text.rotation) - shape.rotation,
			})),
		];
	}
	if (shape.kind === "pin") {
		const cosine = Math.cos(shape.rotation);
		const sine = Math.sin(shape.rotation);
		display.children = (["name", "number"] as const).flatMap((attribute) => {
			const text = shape[attribute];
			const visible =
				(attribute === "name" ? shape.showName : shape.showNumber) ??
				shape.showLabels ??
				true;
			if (!visible || !text) return [];
			const leadNumber =
				(shape.length !== undefined || shape.labelOffset !== undefined) &&
				attribute === "number";
			const fontSize = leadNumber ? 1 : 1.27;
			const width = Math.max(fontSize / 2, text.length * fontSize * 0.6);
			const height = fontSize * 1.5;
			const offset = shape.labelOffset ?? PIN_RADIUS + 0.5;
			const x =
				shape.length !== undefined
					? leadNumber
						? shape.length / 2
						: shape.length + 0.5 + width / 2
					: leadNumber
						? (Math.sign(offset) * Math.max(0, Math.abs(offset) - 0.5)) / 2
						: offset + (offset < 0 ? -width / 2 : width / 2);
			const y =
				shape.length !== undefined || shape.labelOffset !== undefined
					? leadNumber
						? height / 2 + 0.15
						: 0
					: attribute === "name"
						? height / 2
						: -height / 2;
			const labelRotation =
				uprightTextRotation(shape.rotation) - shape.rotation;
			const localY =
				shape.length !== undefined && Math.cos(labelRotation) < 0 ? -y : y;
			return [
				{
					key: `${key}:${attribute}`,
					name: `pin ${attribute} ${shape.id}`,
					geometry: { kind: "text" as const, width, height, lineWidth: 0 },
					x:
						shape.length !== undefined
							? x / shape.width
							: (x * cosine + y * sine) / shape.width,
					y:
						shape.length !== undefined
							? localY / shape.height || 0
							: (-x * sine + y * cosine) / shape.height,
					width: width / shape.width,
					height: height / shape.height,
					rotation:
						shape.length !== undefined ? labelRotation : -shape.rotation,
					appearance,
					text,
					pinLabel: true,
					renderOrder: renderOrder + 1,
				},
			];
		});
	}
	return display;
}

/** Resolve document, selection, and temporary previews without a renderer or UI. */
export function buildDrawingDisplay(
	shapes: EditorShape[],
	selectedIds: ReadonlySet<number>,
	previews: EditorShape[] = [],
): DrawingDisplay {
	const terminal = {
		...drawShape(0, "pin", { x: 0, y: 0 }, { x: 0, y: 0 }),
		length: 0,
	};
	const junctions = wireJunctions(shapes);
	const crossings = measurePerformance(
		"editor.wire-crossings",
		() =>
			buildWireCrossings(
				shapes,
				junctions.map(({ point }) => point),
			),
		{ shapes: shapes.length },
	);
	return {
		shapes: shapes.map((shape, index) => {
			const display = displayShape(
				shape,
				`shape:${shape.id}`,
				`${shape.kind} ${shape.id}`,
				selectedIds.has(shape.id)
					? "selected"
					: shape.kind === "pin" || shape.kind === "wire"
						? shape.kind
						: "stroke",
				index + 1,
			);
			const crossing = crossings.get(shape.id);
			if (display.geometry.kind === "wire" && crossing)
				display.geometry = { ...display.geometry, ...crossing };
			return display;
		}),
		selections: shapes
			.filter((shape) => selectedIds.has(shape.id))
			.map((shape) => ({
				shapeKey: `shape:${shape.id}`,
				...shapeCenter(shape),
				...selectionSize(shape),
				rotation: shape.rotation,
				...(shape.kind === "pin" && (shape.length ?? 0) > 0
					? (() => {
							const bounds = shapeBounds(shape);
							return {
								x: (bounds.minX + bounds.maxX) / 2,
								y: (bounds.minY + bounds.maxY) / 2,
								rotation: 0,
							};
						})()
					: {}),
				renderOrder: shapes.length + 1,
			})),
		terminals: openWireEnds(shapes).map(({ shape, point }) =>
			displayShape(
				{ ...terminal, ...point },
				"wire-terminal",
				"",
				selectedIds.has(shape.id) ? "selected" : "wire",
				shapes.length + 1,
			),
		),
		junctions: junctions.map(({ point, shapes: connected }, index) =>
			displayShape(
				{ ...terminal, ...point },
				`wire-junction:${index}`,
				"editor-wire-junction",
				connected.some((shape) => selectedIds.has(shape.id))
					? "selected"
					: connected.some((shape) => shape.kind !== "wire")
						? "pin"
						: "wire",
				shapes.length + 1,
			),
		),
		connections: shapes.flatMap((shape, index) =>
			shape.kind === "symbol"
				? symbolShapes(shape).flatMap((child) =>
						child.kind === "pin" ||
						child.kind === "wire" ||
						child.kind === "text"
							? [
									displayShape(
										child,
										`shape:${shape.id}:connection:${child.id}`,
										`${child.kind} ${shape.id}:${child.id}`,
										selectedIds.has(shape.id)
											? "selected"
											: child.kind === "pin"
												? "pin"
												: "stroke",
										index + 1,
									),
								]
							: [],
					)
				: [],
		),
		halos: openPins(shapes).map(({ shape, point }, index) => ({
			...displayShape(
				{ ...terminal, ...point },
				`pin-halo:${shape.id}:${index}`,
				"editor-pin-halo",
				selectedIds.has(shape.id) ? "selected" : "pin",
				shapes.length + 1,
			),
			width: PIN_RADIUS * 4,
			height: PIN_RADIUS * 4,
			geometry: {
				kind: "pin-halo",
				width: PIN_RADIUS * 4,
				height: PIN_RADIUS * 4,
				lineWidth: 0.1,
			},
		})),
		previews: previews.flatMap((preview, index) => {
			if (preview.width <= 0) return [];
			const name =
				preview.kind === "symbol"
					? "editor-symbol-preview"
					: preview.kind === "wire"
						? index === 0
							? "editor-wire-preview"
							: "editor-wire-tail-preview"
						: "editor-shape-preview";
			return [
				displayShape(
					preview,
					`preview:${preview.id}`,
					name,
					"selected",
					shapes.length + 2,
				),
				...(preview.kind === "symbol"
					? symbolShapes(preview).flatMap((child) =>
							child.kind === "pin" ||
							child.kind === "wire" ||
							child.kind === "text"
								? [
										displayShape(
											child,
											`preview:${preview.id}:connection:${child.id}`,
											"editor-connection-preview",
											"selected",
											shapes.length + 2,
										),
									]
								: [],
						)
					: []),
			];
		}),
	};
}
