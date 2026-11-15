import type {
	EditorShape,
	EditorSymbol,
	SymbolShape,
	TextShape,
} from "#/drawing/schema.ts";
import { symbolShapes } from "#/drawing/symbol-instances.ts";
import type { Point } from "#/drawing/types.ts";
import { type FootprintLayer, flipLayer } from "#/footprint/layers.ts";
import type { FootprintReference } from "#/footprint/reference.ts";
import { footprintKey } from "#/footprint/reference.ts";
import { isPad, type PadShape, shapeLayer } from "#/footprint/shapes.ts";

export type BoardFootprint = EditorSymbol & {
	footprint: FootprintReference;
};

export const isBoardFootprint = (shape: EditorShape): shape is BoardFootprint =>
	shape.kind === "symbol" && shape.footprint !== undefined;

export interface FootprintSource {
	reference: FootprintReference;
	name: string;
	shapes: readonly EditorShape[];
}

export interface FootprintPart {
	component?: string;
	reference: string;
	value: string;
}

const referenceSize = 1;

function extent(shapes: readonly SymbolShape[]) {
	let x = 0.5;
	let y = 0.5;
	let top = 0.5;
	for (const shape of shapes) {
		const cos = Math.abs(Math.cos(shape.rotation));
		const sin = Math.abs(Math.sin(shape.rotation));
		const height = shape.kind === "line" ? shape.lineWidth : shape.height;
		const halfWidth =
			(shape.width * cos + height * sin) / 2 + shape.lineWidth / 2;
		const halfHeight =
			(shape.width * sin + height * cos) / 2 + shape.lineWidth / 2;
		x = Math.max(x, Math.abs(shape.x) + halfWidth);
		y = Math.max(y, Math.abs(shape.y) + halfHeight);
		if (shape.layer !== "F.Fab" && shape.layer !== "B.Fab")
			top = Math.max(top, shape.y + halfHeight);
	}
	return { width: 2 * x, height: 2 * y, top };
}

const footprintChildren = (shapes: readonly EditorShape[]): SymbolShape[] =>
	shapes.flatMap((shape, index): SymbolShape[] =>
		shape.kind === "symbol" || shape.kind === "pin" || shape.kind === "wire"
			? []
			: shape.kind === "text"
				? [
						{
							...shape,
							id: index + 1,
							layer: shapeLayer(shape),
						} as SymbolShape,
					]
				: [
						{
							...shape,
							id: index + 1,
							layer: shapeLayer(shape),
						} as SymbolShape,
					],
	);

function mirrorChild(child: SymbolShape): SymbolShape {
	const layer = child.layer ? flipLayer(child.layer) : child.layer;
	return {
		...child,
		x: -child.x,
		rotation: -child.rotation,
		...(layer ? { layer } : {}),
	};
}

/** A footprint placed on a board, as a group of its items. */
export function createBoardFootprint(
	id: number,
	source: FootprintSource,
	part: FootprintPart,
	at: Point,
	options: { rotation?: number; flipped?: boolean } = {},
): BoardFootprint {
	let children = footprintChildren(source.shapes);
	if (options.flipped) children = children.map(mirrorChild);
	const size = extent(children);
	return {
		id,
		kind: "symbol",
		x: at.x,
		y: at.y,
		width: size.width,
		height: size.height,
		rotation: options.rotation ?? 0,
		lineWidth: 0.12,
		layer: options.flipped ? "B.SilkS" : "F.SilkS",
		definitionId: `footprint:${footprintKey(source.reference)}`,
		footprint: source.reference,
		...(part.component ? { component: part.component } : {}),
		...(options.flipped ? { flipped: true } : {}),
		children,
		texts: [
			{
				attribute: "reference",
				x: 0,
				y: size.top + referenceSize * 0.8,
				fontSize: referenceSize,
				horizontalAlign: "center",
				verticalAlign: "middle",
			},
		],
		attributes: {
			name: source.name,
			reference: part.reference,
			value: part.value,
		},
	};
}

/** Moves a footprint to the other side of the board, mirrored about its origin. */
export function flipBoardFootprint(footprint: BoardFootprint): BoardFootprint {
	const flipped = !footprint.flipped;
	const { flipped: _flipped, childOverrides: _overrides, ...rest } = footprint;
	return {
		...rest,
		children: footprint.children.map((child) =>
			mirrorChild({
				...child,
				...footprint.childOverrides?.[`shape:${child.id}`],
			} as SymbolShape),
		),
		texts: footprint.texts.map((text) => ({ ...text, x: -text.x })),
		...(footprint.textPositions
			? {
					textPositions: Object.fromEntries(
						Object.entries(footprint.textPositions).map(([key, point]) => [
							key,
							point && { x: -point.x, y: point.y },
						]),
					),
				}
			: {}),
		layer: flipped ? "B.SilkS" : "F.SilkS",
		...(flipped ? { flipped: true } : {}),
	};
}

/** Replaces a placed footprint's items with another footprint's, in place. */
export function replaceBoardFootprintSource(
	footprint: BoardFootprint,
	source: FootprintSource,
): BoardFootprint {
	const next = createBoardFootprint(
		footprint.id,
		source,
		{
			component: footprint.component,
			reference: footprint.attributes.reference,
			value: footprint.attributes.value,
		},
		footprint,
		{ rotation: footprint.rotation, flipped: footprint.flipped },
	);
	return { ...next, ...(footprint.locked ? { locked: true } : {}) };
}

export interface BoardPad {
	/** `<footprint ID>:<child ID>`, unique on the board. */
	key: string;
	footprint: BoardFootprint;
	component?: string;
	number: string;
	/** The pad's copper in board coordinates. */
	shape: PadShape;
}

const padCache = new WeakMap<BoardFootprint, readonly BoardPad[]>();

export function footprintPads(footprint: BoardFootprint): readonly BoardPad[] {
	const cached = padCache.get(footprint);
	if (cached) return cached;
	const pads = symbolShapes(footprint).flatMap((shape): BoardPad[] =>
		isPad(shape)
			? [
					{
						key: `${footprint.id}:${shape.id}`,
						footprint,
						...(footprint.component ? { component: footprint.component } : {}),
						number: shape.pad.number,
						shape,
					},
				]
			: [],
	);
	padCache.set(footprint, pads);
	return pads;
}

export function boardPads(shapes: readonly EditorShape[]): BoardPad[] {
	return shapes.flatMap((shape) =>
		isBoardFootprint(shape) ? footprintPads(shape) : [],
	);
}

/** A footprint's items and reference text in board coordinates. */
export function footprintItems(
	footprint: BoardFootprint,
): readonly SymbolShape[] {
	return symbolShapes(footprint);
}

export function footprintReferenceText(
	footprint: BoardFootprint,
	texts: readonly TextShape[],
): TextShape[] {
	const layer: FootprintLayer = footprint.flipped ? "B.SilkS" : "F.SilkS";
	return texts.map((text) => ({ ...text, layer }));
}
