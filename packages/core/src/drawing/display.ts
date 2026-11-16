import type { LineStyle } from "@ecad/drawing-core/drawing/line-style.ts";
import {
	type ElectricalNet,
	electricalNets,
	isNetLabel,
} from "@ecad/drawing-core/drawing/named-nets.ts";
import { overbarText } from "@ecad/drawing-core/drawing/overbar.ts";
import { pinBubbleRadius } from "@ecad/drawing-core/drawing/pin-types.ts";
import {
	drawShape,
	type EditorShape,
	isBasicShape,
	isBoxSymbol,
	isFillableShape,
	PIN_RADIUS,
	type ShapeKind,
	symbolShapes,
	symbolTextPosition,
	symbolTextShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	type TextAlignment,
	textCenter,
} from "@ecad/drawing-core/drawing/text-alignment.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	PIN_BUBBLE_RADIUS,
	PIN_LABEL_GAP,
	PIN_NUMBER_GAP,
} from "@ecad/drawing-core/drawing/units.ts";
import {
	type FootprintLayer,
	isCopperLayer,
} from "@ecad/drawing-core/footprint/layers.ts";
import {
	isDrilled,
	isHole,
	isPad,
	isVia,
	padCornerRadius,
	shapeDrill,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { analyzeDrawing } from "#/drawing/drawing-analysis.ts";
import {
	fontPixels,
	type MeasureText,
	pinNameFontSize,
	pinNumberFontSize,
	textLayout,
} from "#/drawing/text.ts";
import type { WireCrossings } from "#/drawing/wire-crossings.ts";

interface GeometrySize {
	width: number;
	height: number;
	lineWidth: number;
	lineStyle?: LineStyle;
	filled?: boolean;
	length?: number;
	cornerRadius?: number;
	/** A polygon zone's corners as fractions of the width and height. */
	outline?: readonly Point[];
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
	| (GeometrySize & { kind: "pin-bubble" })
	| (GeometrySize & { kind: "junction" })
	| (GeometrySize & {
			kind: "symbol";
			children: (GeometrySize & DrawingTransform & { kind: ShapeKind })[];
	  });

export type DrawingAppearance =
	| "stroke"
	| "pin"
	| "wire"
	| "highlighted"
	| "selected"
	| "fill"
	| "text"
	| "pin-number"
	| "note"
	| "label"
	| FootprintLayer
	| "pad-through"
	| "via"
	| "pad-hole"
	| "pad-number"
	| "ratsnest"
	| "clearance";

const maximumPadNumberSize = 0.8;

const estimateText: MeasureText = (text) => text.length * fontPixels * 0.6;

const netCache = new WeakMap<EditorShape[], ElectricalNet[]>();

export interface DisplayShape extends DrawingTransform, TextAlignment {
	key: string;
	name: string;
	geometry: DrawingGeometry;
	appearance: DrawingAppearance;
	text?: string;
	bold?: true;
	pinLabel?: true;
	dimmed?: true;
	halo?: true;
	overlay?: true;
	renderOrder: number;
	children?: DisplayShape[];
}

export function rotatesFreeOfParentScale(
	child: DisplayShape,
	parent: DisplayShape | undefined,
): parent is DisplayShape {
	return (
		parent !== undefined &&
		child.rotation !== 0 &&
		(parent.geometry.kind === "symbol" || parent.width !== parent.height)
	);
}

export interface DrawingDisplay {
	shapes: DisplayShape[];
	terminals: DisplayShape[];
	junctions: DisplayShape[];
	connections: DisplayShape[];
	halos: DisplayShape[];
	previews: DisplayShape[];
}

function geometryFor(shape: EditorShape): DrawingGeometry {
	const { kind, width, height, lineWidth } = shape;
	if (isDrilled(shape)) {
		const cornerRadius = padCornerRadius(shape);
		return {
			kind: shape.kind,
			width,
			height,
			lineWidth: 0,
			filled: true,
			...(cornerRadius > 0 ? { cornerRadius } : {}),
		};
	}
	if (kind !== "symbol")
		return {
			kind,
			width,
			height,
			lineWidth,
			...(shape.kind === "pin" && shape.length !== undefined
				? { length: shape.length - 2 * pinBubbleRadius(shape) }
				: {}),
			...(isBasicShape(shape) && shape.lineStyle
				? { lineStyle: shape.lineStyle }
				: {}),
			...(shape.kind === "rectangle" && shape.zone?.outline
				? { outline: shape.zone.outline }
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

export function uprightTextRotation(rotation: number): number {
	const angle = rotation % Math.PI;
	if (angle > Math.PI / 2) return angle - Math.PI;
	if (angle <= -Math.PI / 2) return angle + Math.PI;
	return angle;
}

export function padNumberSize(
	pad: { width: number; height: number },
	number: string,
	measure: MeasureText,
): { width: number; height: number } {
	const fontSize = Math.min(
		maximumPadNumberSize,
		Math.min(pad.width, pad.height) / 2,
	);
	const layout = textLayout(number, measure);
	return {
		width: (layout.width * fontSize) / fontPixels,
		height: (layout.height * fontSize) / fontPixels,
	};
}

const holeEdge = (shape: EditorShape) =>
	Math.min(Math.max(shape.lineWidth, 0.05), shape.width / 4);

function displayShape(
	shape: EditorShape,
	key: string,
	name: string,
	baseAppearance: DrawingAppearance,
	renderOrder: number,
	measure: MeasureText = estimateText,
): DisplayShape {
	const appearance =
		shape.kind === "text" && baseAppearance === "stroke"
			? isNetLabel(shape)
				? "label"
				: "text"
			: baseAppearance;
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
					...(shape.bold ? { bold: true as const } : {}),
					horizontalAlign: shape.horizontalAlign,
					verticalAlign: shape.verticalAlign,
				}
			: {}),
		renderOrder,
	};
	const fillChildren =
		shape.kind === "symbol" &&
		shape.children.some((child) => isFillableShape(child) && child.filled)
			? symbolShapes({ ...shape, x: 0, y: 0, rotation: 0 })
			: isFillableShape(shape) && shape.filled && !isDrilled(shape)
				? [shape]
				: [];
	const fills = fillChildren
		.filter((child) => isFillableShape(child) && child.filled)
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
			appearance: shape.layer ? appearance : ("fill" as const),
			renderOrder: renderOrder - 0.5,
		}));
	if (fills.length) display.children = fills;
	if (isDrilled(shape)) {
		const drill = shapeDrill(shape);
		const number = isPad(shape) ? shape.pad.number : "";
		const { width: labelWidth, height: labelHeight } = padNumberSize(
			shape,
			number,
			measure,
		);
		display.children = [
			...(drill === undefined
				? []
				: [
						{
							key: `${key}:hole`,
							name: `${isPad(shape) ? "pad" : isVia(shape) ? "via" : "unplated"} hole ${shape.id}`,
							geometry: {
								kind: "circle" as const,
								width: drill,
								height: drill,
								lineWidth: 0,
								filled: true,
							},
							x: 0,
							y: 0,
							width: drill / shape.width,
							height: drill / shape.height,
							rotation: 0,
							appearance: "pad-hole" as const,
							renderOrder: renderOrder + 0.25,
						},
					]),
			...(isHole(shape)
				? [
						{
							key: `${key}:edge`,
							name: `unplated hole edge ${shape.id}`,
							geometry: {
								kind: "circle" as const,
								width: shape.width - holeEdge(shape),
								height: shape.width - holeEdge(shape),
								lineWidth: holeEdge(shape),
								filled: false,
							},
							x: 0,
							y: 0,
							width: 1 - holeEdge(shape) / shape.width,
							height: 1 - holeEdge(shape) / shape.width,
							rotation: 0,
							appearance,
							renderOrder: renderOrder + 0.3,
						},
					]
				: []),
			...(number
				? [
						{
							key: `${key}:number`,
							name: `pad number ${shape.id}`,
							geometry: {
								kind: "text" as const,
								width: labelWidth,
								height: labelHeight,
								lineWidth: 0,
							},
							x: 0,
							y: 0,
							width: labelWidth / shape.width,
							height: labelHeight / shape.height,
							rotation: -shape.rotation,
							appearance: "pad-number" as const,
							text: number,
							pinLabel: true as const,
							renderOrder: renderOrder + 0.5,
						},
					]
				: []),
		];
	}
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
					measure,
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
		const bubble = pinBubbleRadius(shape);
		display.children = (["name", "number"] as const).flatMap((attribute) => {
			const text =
				attribute === "name" && shape.activeLow
					? overbarText(shape.name)
					: shape[attribute];
			const visible =
				(attribute === "name" ? shape.showName : shape.showNumber) ??
				shape.showLabels ??
				true;
			if (!visible || !text) return [];
			const leadNumber =
				(shape.length !== undefined || shape.labelOffset !== undefined) &&
				attribute === "number";
			const fontSize = leadNumber ? pinNumberFontSize : pinNameFontSize;
			const layout = textLayout(text, measure);
			const width = (layout.width * fontSize) / fontPixels;
			const height = (layout.height * fontSize) / fontPixels;
			const offset = shape.labelOffset ?? PIN_RADIUS + pinNameFontSize;
			const x =
				shape.length !== undefined
					? leadNumber
						? shape.length / 2
						: shape.length + PIN_LABEL_GAP + width / 2
					: leadNumber
						? (Math.sign(offset) *
								Math.max(0, Math.abs(offset) - PIN_LABEL_GAP)) /
							2
						: offset + (offset < 0 ? -width / 2 : width / 2);
			const y =
				shape.length !== undefined || shape.labelOffset !== undefined
					? leadNumber
						? height / 2 -
							PIN_NUMBER_GAP +
							(shape.length === undefined ? 0 : PIN_BUBBLE_RADIUS)
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
					appearance:
						appearance === "pin" || appearance === "stroke"
							? attribute === "number"
								? ("pin-number" as const)
								: ("text" as const)
							: appearance,
					text,
					pinLabel: true,
					renderOrder: renderOrder + 1,
				},
			];
		});
		if (bubble)
			display.children.push({
				key: `${key}:bubble`,
				name: `pin bubble ${shape.id}`,
				geometry: {
					kind: "pin-bubble",
					width: 2 * bubble,
					height: 2 * bubble,
					lineWidth: shape.lineWidth,
				},
				x: ((shape.length ?? 0) - bubble) / shape.width,
				y: 0,
				width: (2 * bubble) / shape.width,
				height: (2 * bubble) / shape.height,
				rotation: 0,
				appearance,
				renderOrder,
			});
	}
	return display;
}

function unselectedAppearance(shape: EditorShape): DrawingAppearance {
	if (isPad(shape) && shape.pad.type === "through-hole") return "pad-through";
	if (isVia(shape)) return "via";
	if (shape.layer) return shape.layer;
	if (shape.kind === "pin" || shape.kind === "wire") return shape.kind;
	return (shape.kind === "text" && !isNetLabel(shape)) || isBoxSymbol(shape)
		? "note"
		: "stroke";
}

function junctionDisplay(
	...args: Parameters<typeof displayShape>
): DisplayShape {
	const display = displayShape(...args);
	return {
		...display,
		geometry: {
			kind: "junction",
			width: display.geometry.width,
			height: display.geometry.height,
			lineWidth: 0,
		},
	};
}

function sameCrossings(
	first: WireCrossings | undefined,
	second: WireCrossings | undefined,
) {
	if (first === second) return true;
	if (!first || !second) return false;
	return (
		first.bridges.length === second.bridges.length &&
		first.gaps.length === second.gaps.length &&
		first.bridges.every(
			(bridge, index) =>
				bridge.offset === second.bridges[index].offset &&
				bridge.radius === second.bridges[index].radius &&
				bridge.side === second.bridges[index].side,
		) &&
		first.gaps.every(
			(gap, index) =>
				gap.start === second.gaps[index].start &&
				gap.end === second.gaps[index].end,
		)
	);
}

/**
 * Display objects for unchanged shapes keep their identity between builds, so a
 * renderer can skip them. A drag replaces only the moved shapes.
 */
const shapeDisplays = new WeakMap<
	EditorShape,
	{
		appearance: DrawingAppearance;
		renderOrder: number;
		measure: MeasureText;
		crossing: WireCrossings | undefined;
		dimmed: boolean;
		display: DisplayShape;
	}
>();
const connectionDisplays = new WeakMap<
	EditorShape,
	{
		selected: boolean;
		renderOrder: number;
		measure: MeasureText;
		displays: DisplayShape[];
	}
>();

function documentShapeDisplay(
	shape: EditorShape,
	appearance: DrawingAppearance,
	renderOrder: number,
	measure: MeasureText,
	crossing: WireCrossings | undefined,
	dimmed = false,
) {
	const cached = shapeDisplays.get(shape);
	if (
		cached?.appearance === appearance &&
		cached.renderOrder === renderOrder &&
		cached.measure === measure &&
		cached.dimmed === dimmed &&
		sameCrossings(cached.crossing, crossing)
	)
		return cached.display;
	const display = displayShape(
		shape,
		`shape:${shape.id}`,
		`${shape.kind} ${shape.id}`,
		appearance,
		renderOrder,
		measure,
	);
	if (display.geometry.kind === "wire" && crossing)
		display.geometry = { ...display.geometry, ...crossing };
	if (dimmed) dim(display);
	shapeDisplays.set(shape, {
		appearance,
		renderOrder,
		measure,
		crossing,
		dimmed,
		display,
	});
	return display;
}

function dim(display: DisplayShape) {
	display.dimmed = true;
	for (const child of display.children ?? []) dim(child);
}

const outsideFocus = (
	shape: EditorShape,
	appearance: DrawingAppearance,
	focusedLayer: FootprintLayer | undefined,
) =>
	focusedLayer !== undefined &&
	appearance !== "selected" &&
	appearance !== "highlighted" &&
	!shapeLayers(shape).includes(focusedLayer);

function symbolConnectionDisplays(
	shape: EditorShape,
	selected: boolean,
	renderOrder: number,
	measure: MeasureText,
): DisplayShape[] {
	if (shape.kind !== "symbol") return [];
	const cached = connectionDisplays.get(shape);
	if (
		cached?.selected === selected &&
		cached.renderOrder === renderOrder &&
		cached.measure === measure
	)
		return cached.displays;
	const displays = symbolShapes(shape).flatMap((child) =>
		child.kind === "pin" || child.kind === "wire" || child.kind === "text"
			? [
					displayShape(
						child,
						`shape:${shape.id}:connection:${child.id}`,
						`${child.kind} ${shape.id}:${child.id}`,
						selected
							? "selected"
							: child.kind === "pin"
								? "pin"
								: isBoxSymbol(shape)
									? "note"
									: "stroke",
						renderOrder,
						measure,
					),
				]
			: [],
	);
	connectionDisplays.set(shape, { selected, renderOrder, measure, displays });
	return displays;
}

/** The document and selection part of a drawing display, without previews. */
export type StaticDrawingDisplay = Omit<DrawingDisplay, "previews">;

/** Resolve the document and selection without a renderer or UI. */
export function buildStaticDisplay(
	shapes: EditorShape[],
	selectedIds: ReadonlySet<number>,
	measure: MeasureText = estimateText,
	focusedLayer?: FootprintLayer,
): StaticDrawingDisplay {
	const highlightedWires = new Set<number>();
	const netSelections = new Set(
		shapes
			.filter(
				(shape) =>
					selectedIds.has(shape.id) &&
					(shape.kind === "wire" ||
						shape.kind === "pin" ||
						isNetLabel(shape) ||
						(shape.kind === "symbol" && shape.netSymbol)),
			)
			.map((shape) => shape.id),
	);
	if (netSelections.size) {
		let nets = netCache.get(shapes);
		if (!nets) {
			nets = electricalNets(shapes);
			netCache.set(shapes, nets);
		}
		for (const net of nets) {
			if (
				net.wires.some((id) => netSelections.has(id)) ||
				net.labels.some((id) => netSelections.has(id)) ||
				net.pins.some(({ shapeId }) => netSelections.has(shapeId))
			)
				for (const id of net.wires) highlightedWires.add(id);
		}
	}
	const terminal = {
		...drawShape(0, "pin", { x: 0, y: 0 }, { x: 0, y: 0 }),
		length: 0,
	};
	const { junctions, crossings, openEnds, openPins } = analyzeDrawing(shapes);
	return {
		shapes: shapes.map((shape, index) => {
			const appearance = selectedIds.has(shape.id)
				? "selected"
				: highlightedWires.has(shape.id)
					? "highlighted"
					: unselectedAppearance(shape);
			return documentShapeDisplay(
				shape,
				appearance,
				index + 1,
				measure,
				crossings.get(shape.id),
				outsideFocus(shape, appearance, focusedLayer),
			);
		}),
		terminals: openEnds.map(({ shape, point }) =>
			junctionDisplay(
				{ ...terminal, ...point },
				"wire-terminal",
				"",
				selectedIds.has(shape.id)
					? "selected"
					: highlightedWires.has(shape.id)
						? "highlighted"
						: "wire",
				shapes.length + 1,
				measure,
			),
		),
		junctions: junctions.map(({ point, shapes: connected }, index) =>
			junctionDisplay(
				{ ...terminal, ...point },
				`wire-junction:${index}`,
				"editor-wire-junction",
				connected.some((shape) => selectedIds.has(shape.id))
					? "selected"
					: connected.some((shape) => highlightedWires.has(shape.id))
						? "highlighted"
						: connected.some((shape) => shape.kind !== "wire")
							? "pin"
							: "wire",
				shapes.length + 1,
				measure,
			),
		),
		connections: shapes.flatMap((shape, index) =>
			symbolConnectionDisplays(
				shape,
				selectedIds.has(shape.id),
				index + 1,
				measure,
			),
		),
		halos: openPins.map(({ shape, point }, index) => ({
			...displayShape(
				{ ...terminal, ...point },
				`pin-halo:${shape.id}:${index}`,
				"editor-pin-halo",
				selectedIds.has(shape.id) ? "selected" : "pin",
				shapes.length + 1,
				measure,
			),
			width: PIN_RADIUS * 3,
			height: PIN_RADIUS * 3,
			geometry: {
				kind: "pin-halo",
				width: PIN_RADIUS * 3,
				height: PIN_RADIUS * 3,
				lineWidth: 0.1,
			},
		})),
	};
}

/**
 * A board's display: each item in its layer's colour, or the selection or
 * highlight colour, and the ratsnest above everything. Boards have no wire
 * terminals, junctions or pin halos.
 */
export function buildBoardStaticDisplay(
	shapes: EditorShape[],
	selectedIds: ReadonlySet<number>,
	highlightedIds: ReadonlySet<number>,
	ratsnest: readonly EditorShape[],
	measure: MeasureText = estimateText,
	focusedLayer?: FootprintLayer,
): StaticDrawingDisplay {
	return {
		shapes: [
			...shapes.map((shape, index) => {
				const appearance = selectedIds.has(shape.id)
					? "selected"
					: highlightedIds.has(shape.id)
						? "highlighted"
						: unselectedAppearance(shape);
				return documentShapeDisplay(
					shape,
					appearance,
					index + 1,
					measure,
					undefined,
					outsideFocus(shape, appearance, focusedLayer),
				);
			}),
			...ratsnest.map((shape) =>
				documentShapeDisplay(
					shape,
					"ratsnest",
					shapes.length + 1,
					measure,
					undefined,
				),
			),
		],
		terminals: [],
		junctions: [],
		connections: [],
		halos: [],
	};
}

/** Resolve temporary previews, which draw above a document of `shapeCount` shapes. */
export function buildPreviewDisplay(
	previews: EditorShape[],
	shapeCount: number,
	measure: MeasureText = estimateText,
): DisplayShape[] {
	return previews.flatMap((preview, index) => {
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
				shapeCount + 2,
				measure,
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
										shapeCount + 2,
										measure,
									),
								]
							: [],
					)
				: []),
		];
	});
}

const asOverlay = (display: DisplayShape): DisplayShape => ({
	...display,
	overlay: true,
	...(display.children ? { children: display.children.map(asOverlay) } : {}),
});

export function buildBoardPreviewDisplay(
	previews: EditorShape[],
	shapeCount: number,
	measure: MeasureText,
	clearance: number,
): DisplayShape[] {
	const tracks = previews.filter(
		(preview) =>
			preview.kind === "line" &&
			preview.layer !== undefined &&
			isCopperLayer(preview.layer),
	);
	return [
		...tracks.map(
			(track): DisplayShape => ({
				...displayShape(
					{ ...track, lineWidth: track.lineWidth + 2 * clearance },
					`preview:${track.id}:clearance`,
					"editor-track-clearance-preview",
					"clearance",
					shapeCount + 1,
					measure,
				),
				halo: true,
			}),
		),
		...tracks.map((track) =>
			displayShape(
				track,
				`preview:${track.id}`,
				"editor-track-preview",
				unselectedAppearance(track),
				shapeCount + 2,
				measure,
			),
		),
		...buildPreviewDisplay(
			previews.filter((preview) => !tracks.includes(preview)),
			shapeCount,
			measure,
		),
	].map(asOverlay);
}

/** Resolve document, selection, and temporary previews without a renderer or UI. */
export function buildDrawingDisplay(
	shapes: EditorShape[],
	selectedIds: ReadonlySet<number>,
	previews: EditorShape[] = [],
	measure: MeasureText = estimateText,
): DrawingDisplay {
	return {
		...buildStaticDisplay(shapes, selectedIds, measure),
		previews: buildPreviewDisplay(previews, shapes.length, measure),
	};
}
