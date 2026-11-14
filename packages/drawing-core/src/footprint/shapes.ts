import type { EditorShape, FillableShape, ShapePad } from "#/drawing/schema.ts";
import { mergeBounds, shapeBounds } from "#/drawing/shape-geometry.ts";
import type { Bounds, Point } from "#/drawing/types.ts";
import {
	copperLayers,
	type FootprintLayer,
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

export const isFootprintShape = (shape: EditorShape) =>
	footprintShapeKinds.has(shape.kind) &&
	!(shape.kind === "text" && shape.electrical);

export const shapeLayer = (shape: EditorShape): FootprintLayer =>
	shape.layer ?? layerWithoutOne;

export function shapeLayers(shape: EditorShape): readonly FootprintLayer[] {
	return isPad(shape) && shape.pad.type === "through-hole"
		? copperLayers
		: [shapeLayer(shape)];
}

const boardDrawOrder: readonly FootprintLayer[] = [
	"B.Fab",
	"B.CrtYd",
	"B.SilkS",
	"B.Mask",
	"B.Paste",
	"B.Cu",
	"F.Mask",
	"F.Paste",
	"F.Cu",
	"F.SilkS",
	"F.CrtYd",
	"F.Fab",
];

export function footprintLayerView(
	shapes: readonly EditorShape[],
	hidden: ReadonlySet<FootprintLayer>,
	onTop?: FootprintLayer,
): EditorShape[] {
	const drawOrder = onTop
		? [...boardDrawOrder.filter((layer) => layer !== onTop), onTop]
		: boardDrawOrder;
	return shapes
		.flatMap((shape, index) => {
			const visible = shapeLayers(shape).filter((layer) => !hidden.has(layer));
			return visible.length
				? [
						{
							shape,
							index,
							rank: Math.max(
								...visible.map((layer) => drawOrder.indexOf(layer)),
							),
						},
					]
				: [];
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
				layer: copperLayers.includes(layer) ? layer : "F.Cu",
				pad: { number, type },
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

export const padMinorSize = (pad: PadShape) => Math.min(pad.width, pad.height);

function fitDrill(shape: PadShape): PadShape {
	const { drill } = shape.pad;
	return drill === undefined || drill < padMinorSize(shape)
		? shape
		: {
				...shape,
				pad: { ...shape.pad, drill: padMinorSize(shape) * drillShareOfPad },
			};
}

export function fitPad<Shape extends EditorShape>(shape: Shape): Shape {
	return isPad(shape) ? (fitDrill(shape) as Shape) : shape;
}

export type PadEdit =
	| { attribute: "number"; value: string }
	| { attribute: "type"; value: PadType }
	| { attribute: "shape"; value: PadShape["kind"] }
	| { attribute: "drill"; value: number };

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
				const { drill: _drill, ...pad } = shape.pad;
				return { ...shape, pad: { ...pad, type: "smd" } };
			}
			return {
				...shape,
				pad: {
					...shape.pad,
					type: "through-hole",
					drill: padMinorSize(shape) * drillShareOfPad,
				},
			};
		}
		case "shape": {
			if (edit.value === shape.kind) return shape;
			const size = padMinorSize(shape);
			return fitDrill(
				edit.value === "circle"
					? { ...shape, kind: "circle", width: size, height: size }
					: { ...shape, kind: "rectangle" },
			);
		}
		case "drill":
			return shape.pad.type === "through-hole" &&
				edit.value > 0 &&
				edit.value < padMinorSize(shape)
				? { ...shape, pad: { ...shape.pad, drill: edit.value } }
				: shape;
	}
}

export function setShapeLayer(
	shape: EditorShape,
	layer: FootprintLayer,
): EditorShape {
	if (shape.kind === "symbol") return shape;
	if (isPad(shape))
		return shape.pad.type === "smd" && copperLayers.includes(layer)
			? { ...shape, layer }
			: shape;
	return { ...shape, layer };
}

export function footprintFitBounds(shapes: readonly EditorShape[]): Bounds {
	return shapes.length
		? mergeBounds(shapes.map(shapeBounds))
		: emptyFootprintFit;
}
