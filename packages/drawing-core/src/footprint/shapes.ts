import type {
	EditorShape,
	FillableShape,
	ShapeHole,
	ShapePad,
	ShapeVia,
} from "#/drawing/schema.ts";
import { mergeBounds, shapeBounds } from "#/drawing/shape-geometry.ts";
import type { Bounds, Point } from "#/drawing/types.ts";
import {
	copperLayers,
	type FootprintLayer,
	innerCopperLayers,
	isOuterCopperLayer,
	type PadType,
} from "#/footprint/layers.ts";

const footprintShapeKinds: ReadonlySet<EditorShape["kind"]> = new Set([
	"rectangle",
	"circle",
	"triangle",
	"line",
	"text",
]);

const layerWithoutOne: FootprintLayer = "F.SilkS";
const smdPadSize = { width: 1, height: 1.5 } as const;
const throughHolePadSize = 1.7;
const throughHoleDrill = 1;
const drillShareOfPad = 0.6;
const viaSize = 0.6;
const viaDrill = 0.3;
const holeDrill = 3.2;
const emptyFootprintFit: Bounds = { minX: -2, minY: -1.5, maxX: 2, maxY: 1.5 };

const lineWidth = 0.15;
const textSize = 1;

export type PadShape = FillableShape & {
	kind: "rectangle" | "circle";
	pad: ShapePad;
};

export const isPad = (shape: EditorShape): shape is PadShape =>
	(shape.kind === "rectangle" || shape.kind === "circle") &&
	shape.pad !== undefined;

export type ViaShape = FillableShape & { kind: "circle"; via: ShapeVia };

export const isVia = (shape: EditorShape): shape is ViaShape =>
	shape.kind === "circle" && shape.via !== undefined;

export const isPadOrVia = (shape: EditorShape): shape is PadShape | ViaShape =>
	isPad(shape) || isVia(shape);

export type HoleShape = FillableShape & { kind: "circle"; hole: ShapeHole };

export const isHole = (shape: EditorShape): shape is HoleShape =>
	shape.kind === "circle" && shape.hole !== undefined;

export const isDrilled = (
	shape: EditorShape,
): shape is PadShape | ViaShape | HoleShape =>
	isPadOrVia(shape) || isHole(shape);

export const shapeDrill = (shape: EditorShape): number | undefined =>
	isPad(shape)
		? shape.pad.drill
		: isVia(shape)
			? shape.via.drill
			: isHole(shape)
				? shape.hole.drill
				: undefined;

export const slotReach = (shape: EditorShape): number =>
	isPad(shape) && shape.pad.slot !== undefined && shape.pad.drill !== undefined
		? (shape.pad.slot - shape.pad.drill) / 2
		: 0;

export function shapeHole(
	shape: EditorShape,
): { diameter: number; ends: [Point, Point] } | undefined {
	const diameter = shapeDrill(shape);
	if (diameter === undefined) return undefined;
	const reach = slotReach(shape);
	const dx = reach * Math.cos(shape.rotation);
	const dy = reach * Math.sin(shape.rotation);
	return {
		diameter,
		ends: [
			{ x: shape.x - dx, y: shape.y - dy },
			{ x: shape.x + dx, y: shape.y + dy },
		],
	};
}

export const isFootprintShape = (shape: EditorShape) =>
	footprintShapeKinds.has(shape.kind) &&
	!(shape.kind === "text" && shape.electrical);

export const shapeLayer = (shape: EditorShape): FootprintLayer =>
	shape.layer ?? layerWithoutOne;

const maskLayers: readonly FootprintLayer[] = ["F.Mask", "B.Mask"];

const pasteLayers: Partial<Record<FootprintLayer, FootprintLayer>> = {
	"F.Cu": "F.Paste",
	"B.Cu": "B.Paste",
};

export function shapeLayers(shape: EditorShape): readonly FootprintLayer[] {
	if (isVia(shape)) return copperLayers;
	if (isHole(shape)) return maskLayers;
	if (!isPad(shape)) return [shapeLayer(shape)];
	if (shape.pad.type === "through-hole") return copperLayers;
	const copper = shapeLayer(shape);
	const paste = shape.pad.paste ? pasteLayers[copper] : undefined;
	return paste ? [copper, paste] : [copper];
}

const backLayers: readonly FootprintLayer[] = [
	"B.Fab",
	"B.CrtYd",
	"B.SilkS",
	"B.Mask",
	"B.Paste",
	"B.Cu",
];
const frontLayers: readonly FootprintLayer[] = [
	"F.Mask",
	"F.Paste",
	"F.Cu",
	"F.SilkS",
	"F.CrtYd",
	"F.Fab",
	"Edge.Cuts",
];

export const boardDrawOrder: readonly FootprintLayer[] = [
	...backLayers,
	...frontLayers,
];

export const stackDrawOrder: readonly FootprintLayer[] = [
	...backLayers,
	...[...innerCopperLayers].reverse(),
	...frontLayers,
];

/** @return The shapes on a layer of `drawOrder` that is not hidden, bottom first, with `onTop` drawn last. */
export function footprintLayerView(
	shapes: readonly EditorShape[],
	hidden: ReadonlySet<FootprintLayer>,
	onTop?: FootprintLayer,
	drawOrder: readonly FootprintLayer[] = boardDrawOrder,
): EditorShape[] {
	const ranks = new Map(
		(onTop && drawOrder.includes(onTop)
			? [...drawOrder.filter((layer) => layer !== onTop), onTop]
			: drawOrder
		).map((layer, index) => [layer, index]),
	);
	return shapes
		.flatMap((shape, index) => {
			let rank = -1;
			for (const layer of shapeLayers(shape)) {
				const own = ranks.get(layer);
				if (own !== undefined && own > rank && !hidden.has(layer)) rank = own;
			}
			return rank >= 0 ? [{ shape, index, rank }] : [];
		})
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map(({ shape }) => shape);
}

export function onFootprintLayer<Shape extends EditorShape>(
	shape: Shape,
	layer: FootprintLayer,
): Shape {
	if (shape.kind !== "text") return { ...shape, layer, lineWidth };
	const scale = textSize / shape.fontSize;
	return {
		...shape,
		layer,
		fontSize: textSize,
		width: shape.width * scale,
		height: shape.height * scale,
	};
}

export function nextPadNumber(shapes: readonly EditorShape[]): string {
	let highest = 0;
	for (const shape of shapes)
		if (isPad(shape) && /^\d+$/.test(shape.pad.number))
			highest = Math.max(highest, Number(shape.pad.number));
	return String(highest + 1);
}

const smdPadLayer = (active: FootprintLayer): FootprintLayer =>
	isOuterCopperLayer(active) ? active : "F.Cu";

export const newPadLayers = (
	type: PadType,
	active: FootprintLayer,
): readonly FootprintLayer[] =>
	type === "through-hole"
		? copperLayers
		: shapeLayers(createPad(0, { x: 0, y: 0 }, type, "", active));

export function createPad(
	id: number,
	center: Point,
	type: PadType,
	number: string,
	layer: FootprintLayer,
): PadShape {
	const base = {
		id,
		...center,
		rotation: 0,
		lineWidth,
		filled: true,
	};
	return type === "smd"
		? {
				...base,
				kind: "rectangle",
				...smdPadSize,
				layer: smdPadLayer(layer),
				pad: { number, type, paste: true },
			}
		: {
				...base,
				kind: "circle",
				width: throughHolePadSize,
				height: throughHolePadSize,
				layer: "F.Cu",
				pad: { number, type, drill: throughHoleDrill },
			};
}

export const createVia = (id: number, center: Point): ViaShape => ({
	id,
	kind: "circle",
	...center,
	width: viaSize,
	height: viaSize,
	rotation: 0,
	lineWidth,
	filled: true,
	layer: "F.Cu",
	via: { drill: viaDrill },
});

export const editVia = (shape: ViaShape, drill: number): ViaShape =>
	drill > 0 && drill < shape.width ? { ...shape, via: { drill } } : shape;

export const createHole = (id: number, center: Point): HoleShape => ({
	id,
	kind: "circle",
	...center,
	width: holeDrill,
	height: holeDrill,
	rotation: 0,
	lineWidth,
	filled: true,
	layer: "F.Mask",
	hole: { drill: holeDrill },
});

export const editHole = (shape: HoleShape, drill: number): HoleShape =>
	drill > 0
		? {
				...shape,
				width: Math.max(shape.width, drill),
				height: Math.max(shape.height, drill),
				hole: { drill },
			}
		: shape;

export const padMinorSize = (pad: PadShape) => Math.min(pad.width, pad.height);

export const padCornerRadius = (shape: EditorShape): number =>
	isPad(shape) && shape.kind === "rectangle"
		? (shape.pad.cornerRatio ?? 0) * padMinorSize(shape)
		: 0;

export type PadOutline = PadShape["kind"] | "oval";

export const padOutline = (pad: PadShape): PadOutline =>
	pad.kind === "rectangle" && pad.pad.cornerRatio === 0.5 ? "oval" : pad.kind;

export const fittingSlot = (pad: PadShape, drill: number): number =>
	Math.max(pad.width - (pad.height - drill), (drill + pad.width) / 2);

function fitDrill(shape: PadShape): PadShape {
	let { drill, slot } = shape.pad;
	if (drill === undefined) return shape;
	if (drill >= padMinorSize(shape))
		drill = padMinorSize(shape) * drillShareOfPad;
	if (slot !== undefined && (slot >= shape.width || slot <= drill))
		slot = fittingSlot(shape, drill);
	if (drill === shape.pad.drill && slot === shape.pad.slot) return shape;
	return {
		...shape,
		pad: { ...shape.pad, drill, ...(slot === undefined ? {} : { slot }) },
	};
}

export function fitHole<Shape extends EditorShape>(shape: Shape): Shape {
	if (isPad(shape)) return fitDrill(shape) as Shape;
	if (isVia(shape) && shape.via.drill >= shape.width)
		return { ...shape, via: { drill: shape.width * drillShareOfPad } } as Shape;
	if (isHole(shape) && shape.hole.drill > shape.width)
		return { ...shape, hole: { drill: shape.width } } as Shape;
	return shape;
}

export type PadEdit =
	| { attribute: "number"; value: string }
	| { attribute: "type"; value: PadType }
	| { attribute: "shape"; value: PadOutline }
	| { attribute: "drill"; value: number }
	| { attribute: "hole"; value: "round" | "slot" }
	| { attribute: "slot"; value: number }
	| { attribute: "paste"; value: boolean }
	| { attribute: "cornerRadius"; value: number };

export function editPad(shape: PadShape, edit: PadEdit): PadShape {
	switch (edit.attribute) {
		case "number":
			return {
				...shape,
				pad: { ...shape.pad, number: edit.value.slice(0, 16) },
			};
		case "type": {
			if (edit.value === shape.pad.type) return shape;
			if (edit.value === "smd") {
				const { drill: _drill, slot: _slot, ...pad } = shape.pad;
				return { ...shape, pad: { ...pad, type: "smd", paste: true } };
			}
			const { paste: _paste, ...pad } = shape.pad;
			return {
				...shape,
				pad: {
					...pad,
					type: "through-hole",
					drill: padMinorSize(shape) * drillShareOfPad,
				},
			};
		}
		case "shape": {
			const outline = padOutline(shape);
			if (edit.value === outline) return shape;
			const size = padMinorSize(shape);
			const { cornerRatio: _cornerRatio, ...pad } = shape.pad;
			if (edit.value === "circle")
				return fitDrill({
					...shape,
					kind: "circle",
					width: size,
					height: size,
					pad,
				});
			if (edit.value === "oval")
				return fitDrill({
					...shape,
					kind: "rectangle",
					pad: { ...pad, cornerRatio: 0.5 },
				});
			return fitDrill({ ...shape, kind: "rectangle", pad });
		}
		case "drill":
			return shape.pad.type === "through-hole" &&
				edit.value > 0 &&
				edit.value < padMinorSize(shape) &&
				(shape.pad.slot === undefined || edit.value < shape.pad.slot)
				? { ...shape, pad: { ...shape.pad, drill: edit.value } }
				: shape;
		case "hole": {
			const { drill, slot: _slot, ...pad } = shape.pad;
			if (shape.pad.type !== "through-hole" || drill === undefined)
				return shape;
			if (edit.value === "round")
				return shape.pad.slot === undefined
					? shape
					: { ...shape, pad: { ...pad, drill } };
			if (shape.pad.slot !== undefined) return shape;
			const turned =
				shape.height > shape.width
					? {
							...shape,
							width: shape.height,
							height: shape.width,
							rotation: (shape.rotation + Math.PI / 2) % (2 * Math.PI),
						}
					: shape;
			return {
				...turned,
				pad: { ...pad, drill, slot: fittingSlot(turned, drill) },
			};
		}
		case "slot":
			return shape.pad.slot !== undefined &&
				shape.pad.drill !== undefined &&
				edit.value > shape.pad.drill &&
				edit.value < shape.width
				? { ...shape, pad: { ...shape.pad, slot: edit.value } }
				: shape;
		case "paste":
			return shape.pad.type === "smd"
				? { ...shape, pad: { ...shape.pad, paste: edit.value } }
				: shape;
		case "cornerRadius": {
			if (shape.kind !== "rectangle" || !(edit.value >= 0)) return shape;
			const ratio = Math.min(0.5, edit.value / padMinorSize(shape));
			const { cornerRatio: _cornerRatio, ...pad } = shape.pad;
			return {
				...shape,
				pad: ratio > 0 ? { ...pad, cornerRatio: ratio } : pad,
			};
		}
	}
}

export function setShapeLayer(
	shape: EditorShape,
	layer: FootprintLayer,
): EditorShape {
	if (shape.kind === "symbol" || isVia(shape) || isHole(shape)) return shape;
	if (isPad(shape))
		return shape.pad.type === "smd" && isOuterCopperLayer(layer)
			? { ...shape, layer }
			: shape;
	return { ...shape, layer };
}

export function footprintFitBounds(shapes: readonly EditorShape[]): Bounds {
	return shapes.length
		? mergeBounds(shapes.map(shapeBounds))
		: emptyFootprintFit;
}
