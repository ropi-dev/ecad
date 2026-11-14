import {
	type EditorShape,
	expandBounds,
	mergeBounds,
	shapeBounds,
	type TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	footprintFitBounds,
	isPad,
	shapeLayer,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import type {
	Bounds,
	Geometry,
	Matrix,
	PlanarObject,
	SceneObject,
} from "#/engine/types.ts";
import {
	BOARD_STACK_TOP,
	type BoardPlacement,
	placeBoardLayers,
} from "#/formats/gerber/board-stack.ts";

const boardMargin = 1;
const boardEdgeWidth = 0.1;
const drawingGap = 0.02;
export const DRILL_LAYER_ID = "footprint:drill";
export const BOARD_LAYER_ID = "footprint:board";

const stackLayers: readonly (readonly [FootprintLayer, string])[] = [
	["F.Cu", "Copper,L1,Top"],
	["B.Cu", "Copper,L2,Bot"],
	["F.SilkS", "Legend,Top"],
	["B.SilkS", "Legend,Bot"],
	["F.Mask", "Soldermask,Top"],
	["B.Mask", "Soldermask,Bot"],
	["F.Paste", "Paste,Top"],
	["B.Paste", "Paste,Bot"],
];
const drawingLayers: readonly (readonly [FootprintLayer, string, number])[] = [
	["F.Fab", "AssemblyDrawing,Top", 1],
	["B.Fab", "AssemblyDrawing,Bot", -1],
	["F.CrtYd", "Other,Courtyard,Top", 2],
	["B.CrtYd", "Other,Courtyard,Bot", -2],
];
const boardLayers: readonly (readonly [FootprintLayer, string])[] = [
	...stackLayers,
	...drawingLayers.map(
		([layer, fileFunction]) => [layer, fileFunction] as const,
	),
];
const fileFunctionAttribute = (fileFunction: string) => ({
	".FileFunction": fileFunction.split(","),
});
const placements = new Map<string, BoardPlacement>([
	...stackLayers.map(
		([layer, fileFunction]) =>
			[
				layer,
				placeBoardLayers([
					{ name: layer, metadata: fileFunctionAttribute(fileFunction) },
				])[0],
			] as const,
	),
	...drawingLayers.map(
		([layer, , step]) =>
			[
				layer,
				{
					z: Math.sign(step) * BOARD_STACK_TOP + step * drawingGap,
					thickness: 0,
					depthBias: 3 + Math.abs(step),
					through: false,
				},
			] as const,
	),
]);
const layerObjectId = (layer: FootprintLayer) => `footprint:${layer}`;
const textObjectId = (layer: FootprintLayer) => `footprint:${layer}:text`;
const layersByObjectId = new Map(
	boardLayers.flatMap(([layer]) => [
		[layerObjectId(layer), layer] as const,
		[textObjectId(layer), layer] as const,
	]),
);

/** The board height that the 3D view puts on the grid plane. */
export const BOARD_SURFACE_Z = BOARD_STACK_TOP;

/** Courtyard and fabrication drawings lie flat just outside the layer stack. */
export const placeFootprintBoard: typeof placeBoardLayers = (layers) => {
	const stack = placeBoardLayers(layers);
	return layers.map(
		(layer, index) => placements.get(layer.name) ?? stack[index],
	);
};

/**
 * Height in the 3D view of the surface that items on these layers are drawn
 * on. A pad on both sides of the board uses the side facing a camera at
 * height `eyeZ`.
 */
export function layerSurfaceZ(
	layers: readonly FootprintLayer[],
	hidden: ReadonlySet<FootprintLayer>,
	eyeZ: number,
): number {
	const shown = layers.filter((layer) => !hidden.has(layer));
	const heights = (shown.length ? shown : layers).map(
		(layer) => (placements.get(layer)?.z ?? 0) - BOARD_SURFACE_Z,
	);
	if (!heights.length) return 0;
	return eyeZ >= -BOARD_SURFACE_Z ? Math.max(...heights) : Math.min(...heights);
}

function placement(shape: EditorShape): Matrix {
	const cos = Math.cos(shape.rotation);
	const sin = Math.sin(shape.rotation);
	return [cos, sin, -sin, cos, shape.x, shape.y];
}

const closedPath = (points: readonly (readonly [number, number])[]) =>
	`${points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join("")}Z`;

const rectanglePath = ({ minX, minY, maxX, maxY }: Bounds) =>
	closedPath([
		[minX, minY],
		[maxX, minY],
		[maxX, maxY],
		[minX, maxY],
	]);

function shapeGeometry(shape: EditorShape): Geometry | undefined {
	const { width, height, lineWidth } = shape;
	if (shape.kind === "line")
		return {
			type: "path",
			d: `M${-width / 2} 0L${width / 2} 0`,
			fill: false,
			strokeWidth: lineWidth,
		};
	if (shape.kind === "circle") {
		const radius = width / 2;
		if (isPad(shape)) return { type: "circle", x: 0, y: 0, radius };
		const outer: Geometry = {
			type: "circle",
			x: 0,
			y: 0,
			radius: radius + lineWidth / 2,
		};
		return shape.filled || radius <= lineWidth / 2
			? outer
			: {
					type: "group",
					children: [
						{ geometry: outer, polarity: "dark" },
						{
							geometry: {
								type: "circle",
								x: 0,
								y: 0,
								radius: radius - lineWidth / 2,
							},
							polarity: "clear",
						},
					],
				};
	}
	if (shape.kind === "rectangle" && isPad(shape))
		return { type: "rect", x: 0, y: 0, width, height };
	if (shape.kind === "rectangle")
		return {
			type: "path",
			d: rectanglePath({
				minX: -width / 2,
				minY: -height / 2,
				maxX: width / 2,
				maxY: height / 2,
			}),
			fill: shape.filled === true,
			strokeWidth: lineWidth,
		};
	if (shape.kind === "triangle")
		return {
			type: "path",
			d: closedPath([
				[-width / 2, -height / 2],
				[width / 2, -height / 2],
				[0, height / 2],
			]),
			fill: shape.filled === true,
			strokeWidth: lineWidth,
		};
	return undefined;
}

const strokedBounds = (shape: EditorShape) =>
	expandBounds(
		shapeBounds(shape),
		isPad(shape) || shape.kind === "line" || shape.kind === "text"
			? 0
			: shape.lineWidth / 2,
	);

function planarLayer(
	id: string,
	name: string,
	color: string,
	fileFunction: string,
	objects: SceneObject[],
): PlanarObject {
	return {
		type: "planar",
		id,
		name,
		objects,
		bounds: mergeBounds(objects.map((object) => object.bounds)),
		color,
		visible: true,
		opacity: 1,
		metadata: fileFunctionAttribute(fileFunction),
	};
}

/** The board edge lies 1 mm outside the footprint, or outside a 4 by 3 mm area while it is empty. */
export const boardEdgeBounds = (shapes: readonly EditorShape[]): Bounds =>
	expandBounds(
		shapes.length
			? mergeBounds(shapes.map(strokedBounds))
			: footprintFitBounds(shapes),
		boardMargin,
	);

export interface BoardLayerPlan {
	id: string;
	/** What the layer is built from. Plans with equal entries build the same layer. */
	source: readonly unknown[];
	/** How the 3D view gives the layer its thickness. Flat drawings have none. */
	extrude?: "slab" | "barrel";
	/** The layer's text, which the view draws from glyph textures on its surface. */
	texts?: readonly TextShape[];
	build(): PlanarObject;
}

/** Lists the board's layers without building them, so unchanged ones can be kept. */
export function planFootprintBoard(
	shapes: readonly EditorShape[],
): BoardLayerPlan[] {
	const members = new Map<FootprintLayer, EditorShape[]>();
	const texts = new Map<FootprintLayer, TextShape[]>();
	const drilled: EditorShape[] = [];
	for (const shape of shapes) {
		if (shape.kind === "text") {
			const layer = shapeLayer(shape);
			const onLayer = texts.get(layer) ?? [];
			onLayer.push(shape);
			texts.set(layer, onLayer);
			continue;
		}
		if (!shapeGeometry(shape)) continue;
		for (const layer of shapeLayers(shape)) {
			const onLayer = members.get(layer) ?? [];
			onLayer.push(shape);
			members.set(layer, onLayer);
		}
		if (isPad(shape) && shape.pad.drill !== undefined) drilled.push(shape);
	}
	const edge = boardEdgeBounds(shapes);
	const colors = darkSchematicTheme.appearance;
	return [
		{
			id: BOARD_LAYER_ID,
			source: [edge.minX, edge.minY, edge.maxX, edge.maxY],
			extrude: "slab",
			build: () =>
				planarLayer(
					BOARD_LAYER_ID,
					"Board edge",
					colors["F.Fab"],
					"Profile,NP",
					[
						{
							id: "board-edge",
							geometry: {
								type: "path",
								d: rectanglePath(edge),
								fill: false,
								strokeWidth: boardEdgeWidth,
							},
							bounds: edge,
							polarity: "dark",
							attributes: {},
						},
					],
				),
		},
		...boardLayers.flatMap(([layer, fileFunction]): BoardLayerPlan[] => {
			const onLayer = members.get(layer);
			return onLayer
				? [
						{
							id: layerObjectId(layer),
							source: onLayer,
							extrude: placements.get(layer)?.thickness ? "slab" : undefined,
							build: () =>
								planarLayer(
									layerObjectId(layer),
									layer,
									colors[layer],
									fileFunction,
									onLayer.flatMap((shape): SceneObject[] => {
										const geometry = shapeGeometry(shape);
										return geometry
											? [
													{
														id: `${layer}:${shape.id}`,
														geometry,
														bounds: strokedBounds(shape),
														polarity: "dark",
														transform: placement(shape),
														attributes: {},
													},
												]
											: [];
									}),
								),
						},
					]
				: [];
		}),
		...boardLayers.flatMap(([layer, fileFunction]): BoardLayerPlan[] => {
			const onLayer = texts.get(layer);
			return onLayer
				? [
						{
							id: textObjectId(layer),
							source: onLayer,
							texts: onLayer,
							build: () => ({
								...planarLayer(
									textObjectId(layer),
									layer,
									colors[layer],
									fileFunction,
									[],
								),
								bounds: mergeBounds(onLayer.map(shapeBounds)),
							}),
						},
					]
				: [];
		}),
		...(drilled.length
			? [
					{
						id: DRILL_LAYER_ID,
						source: drilled,
						extrude: "barrel" as const,
						build: () =>
							planarLayer(
								DRILL_LAYER_ID,
								"Drills",
								colors["pad-through"],
								"Plated,1,2,PTH",
								drilled.flatMap((shape): SceneObject[] => {
									if (!isPad(shape) || shape.pad.drill === undefined) return [];
									const radius = shape.pad.drill / 2;
									return [
										{
											id: `drill:${shape.id}`,
											geometry: {
												type: "circle",
												x: shape.x,
												y: shape.y,
												radius,
											},
											bounds: expandBounds(
												{
													minX: shape.x,
													minY: shape.y,
													maxX: shape.x,
													maxY: shape.y,
												},
												radius,
											),
											polarity: "dark",
											attributes: {},
										},
									];
								}),
							),
					},
				]
			: []),
	];
}

export const footprintBoard = (
	shapes: readonly EditorShape[],
): PlanarObject[] => planFootprintBoard(shapes).map((plan) => plan.build());

export function boardObjectVisible(
	id: string,
	hidden: ReadonlySet<FootprintLayer>,
): boolean {
	if (id === DRILL_LAYER_ID) return !hidden.has("F.Cu") || !hidden.has("B.Cu");
	const layer = layersByObjectId.get(id);
	return layer === undefined || !hidden.has(layer);
}
