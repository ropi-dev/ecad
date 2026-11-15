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
	isPadOrVia,
	type PadShape,
	shapeDrill,
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
const padNumberSides = [
	["F.Cu", "Other,PadNumbers,Top", 1],
	["B.Cu", "Other,PadNumbers,Bot", -1],
] as const;
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
	...padNumberSides.map(
		([layer, , side]) =>
			[
				padNumberLayerName(layer),
				{
					z: side * (BOARD_STACK_TOP + 3 * drawingGap),
					thickness: 0,
					depthBias: 6,
					through: false,
				},
			] as const,
	),
]);
function padNumberLayerName(layer: FootprintLayer) {
	return `${layer} pad numbers`;
}
const layerObjectId = (layer: FootprintLayer) => `footprint:${layer}`;
const textObjectId = (layer: FootprintLayer) => `footprint:${layer}:text`;
const padNumberObjectId = (layer: FootprintLayer) =>
	`footprint:${layer}:pad-numbers`;
const layersByObjectId = new Map([
	...boardLayers.flatMap(([layer]) => [
		[layerObjectId(layer), layer] as const,
		[textObjectId(layer), layer] as const,
	]),
	...padNumberSides.map(
		([layer]) => [padNumberObjectId(layer), layer] as const,
	),
]);

export const BOARD_SURFACE_Z = BOARD_STACK_TOP;

export const placeFootprintBoard: typeof placeBoardLayers = (layers) => {
	const stack = placeBoardLayers(layers);
	return layers.map(
		(layer, index) => placements.get(layer.name) ?? stack[index],
	);
};

export function layerSurfaceZ(
	layers: readonly FootprintLayer[],
	hidden: ReadonlySet<FootprintLayer>,
	eyeZ: number,
): number {
	const shown = layers.filter((layer) => !hidden.has(layer));
	const heights = (shown.length ? shown : layers).map(
		(layer) => (placements.get(layer)?.z ?? 0) - BOARD_SURFACE_Z,
	);
	return heights.reduce(
		(nearest, height) =>
			Math.abs(eyeZ - height) < Math.abs(eyeZ - nearest) ? height : nearest,
		heights[0] ?? 0,
	);
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
		if (isPadOrVia(shape)) return { type: "circle", x: 0, y: 0, radius };
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
		isPadOrVia(shape) || shape.kind === "line" || shape.kind === "text"
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

export function boardEdgeBounds(shapes: readonly EditorShape[]): Bounds {
	const outline = shapes.filter((shape) => shape.layer === "Edge.Cuts");
	if (outline.length) return mergeBounds(outline.map(strokedBounds));
	return expandBounds(
		shapes.length
			? mergeBounds(shapes.map(strokedBounds))
			: footprintFitBounds(shapes),
		boardMargin,
	);
}

export type BoardLayerSource = readonly (EditorShape | number | BoardRegion)[];

/** Copper regions drawn on a layer besides its shapes, such as zone fills. */
export interface BoardRegion {
	layer: FootprintLayer;
	polygons: readonly (readonly (readonly [number, number])[])[][];
}

export interface BoardPlanOptions {
	regions?: readonly BoardRegion[];
}

const regionPath = (polygons: BoardRegion["polygons"]) =>
	polygons
		.flatMap((rings) =>
			rings.map(
				(ring) =>
					`${ring.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join("")}Z`,
			),
		)
		.join("");

const regionBounds = (polygons: BoardRegion["polygons"]): Bounds => {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const rings of polygons)
		for (const [x, y] of rings[0] ?? []) {
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	return { minX, minY, maxX, maxY };
};

export interface BoardLayerPlan {
	id: string;
	source: BoardLayerSource;
	extrude?: "slab" | "barrel";
	texts?: readonly TextShape[];
	padNumbers?: { pads: readonly PadShape[]; bottom: boolean };
	build(): PlanarObject;
}

export function planFootprintBoard(
	shapes: readonly EditorShape[],
	options: BoardPlanOptions = {},
): BoardLayerPlan[] {
	const regions = new Map<FootprintLayer, BoardRegion[]>();
	for (const region of options.regions ?? [])
		if (region.polygons.length) {
			const onLayer = regions.get(region.layer) ?? [];
			onLayer.push(region);
			regions.set(region.layer, onLayer);
		}
	const outline = shapes.filter((shape) => shape.layer === "Edge.Cuts");
	const members = new Map<FootprintLayer, EditorShape[]>();
	const texts = new Map<FootprintLayer, TextShape[]>();
	const drilled: EditorShape[] = [];
	const numbered = new Map<FootprintLayer, PadShape[]>();
	for (const shape of shapes) {
		if (isPad(shape) && shape.pad.number)
			for (const layer of shapeLayers(shape)) {
				const onLayer = numbered.get(layer) ?? [];
				onLayer.push(shape);
				numbered.set(layer, onLayer);
			}
		if (shape.kind === "text") {
			const layer = shapeLayer(shape);
			const onLayer = texts.get(layer) ?? [];
			onLayer.push(shape);
			texts.set(layer, onLayer);
			continue;
		}
		if (!shapeGeometry(shape) || shape.layer === "Edge.Cuts") continue;
		if (shape.kind === "rectangle" && shape.zone) continue;
		for (const layer of shapeLayers(shape)) {
			const onLayer = members.get(layer) ?? [];
			onLayer.push(shape);
			members.set(layer, onLayer);
		}
		if (shapeDrill(shape) !== undefined) drilled.push(shape);
	}
	const edge = boardEdgeBounds(shapes);
	const colors = darkSchematicTheme.appearance;
	const edgeObjects = (): SceneObject[] =>
		outline.length
			? outline.flatMap((shape): SceneObject[] => {
					const geometry = shapeGeometry({
						...shape,
						filled: false,
					} as EditorShape);
					return geometry
						? [
								{
									id: `edge:${shape.id}`,
									geometry,
									bounds: strokedBounds(shape),
									polarity: "dark",
									transform: placement(shape),
									attributes: {},
								},
							]
						: [];
				})
			: [
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
				];
	return [
		{
			id: BOARD_LAYER_ID,
			source: outline.length
				? outline
				: [edge.minX, edge.minY, edge.maxX, edge.maxY],
			build: () =>
				planarLayer(
					BOARD_LAYER_ID,
					"Board edge",
					colors[outline.length ? "Edge.Cuts" : "F.Fab"],
					"Profile,NP",
					edgeObjects(),
				),
		},
		...boardLayers.flatMap(([layer, fileFunction]): BoardLayerPlan[] => {
			const onLayer = members.get(layer);
			const layerRegions = regions.get(layer) ?? [];
			return onLayer || layerRegions.length
				? [
						{
							id: layerObjectId(layer),
							source: [...(onLayer ?? []), ...layerRegions],
							extrude: placements.get(layer)?.thickness ? "slab" : undefined,
							build: () =>
								planarLayer(
									layerObjectId(layer),
									layer,
									colors[layer],
									fileFunction,
									[
										...layerRegions.map(
											(region, index): SceneObject => ({
												id: `${layer}:region:${index}`,
												geometry: {
													type: "path",
													d: regionPath(region.polygons),
													fill: true,
												},
												bounds: regionBounds(region.polygons),
												polarity: "dark",
												attributes: {},
											}),
										),
										...(onLayer ?? []).flatMap((shape): SceneObject[] => {
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
									],
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
		...padNumberSides.flatMap(([layer, fileFunction, side]) => {
			const pads = numbered.get(layer);
			return pads
				? [
						{
							id: padNumberObjectId(layer),
							source: pads,
							padNumbers: { pads, bottom: side < 0 },
							build: () => ({
								...planarLayer(
									padNumberObjectId(layer),
									padNumberLayerName(layer),
									colors["pad-number"],
									fileFunction,
									[],
								),
								bounds: mergeBounds(pads.map(shapeBounds)),
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
									const drill = shapeDrill(shape);
									if (drill === undefined) return [];
									const radius = drill / 2;
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

export const sameSource = (a: BoardLayerSource, b: BoardLayerSource) =>
	a.length === b.length && a.every((item, index) => item === b[index]);

export function createBoardBuilder<Layer extends { dispose(): void }>(
	buildLayer: (plan: BoardLayerPlan) => Layer,
) {
	type Built = { source: BoardLayerSource; layer: Layer };
	let layers = new Map<string, Built>();
	let retired: Layer[] = [];
	return {
		build(shapes: readonly EditorShape[], options?: BoardPlanOptions): Layer[] {
			const next = new Map<string, Built>();
			try {
				for (const plan of planFootprintBoard(shapes, options)) {
					const kept = layers.get(plan.id);
					next.set(
						plan.id,
						kept && sameSource(kept.source, plan.source)
							? kept
							: { source: plan.source, layer: buildLayer(plan) },
					);
				}
			} catch (cause) {
				for (const [id, built] of next)
					if (layers.get(id) !== built) built.layer.dispose();
				throw cause;
			}
			for (const [id, built] of layers)
				if (next.get(id) !== built) retired.push(built.layer);
			layers = next;
			return [...next.values()].map((built) => built.layer);
		},
		release(shown: readonly Layer[]) {
			const kept = new Set(shown);
			retired = retired.filter((layer) => {
				if (kept.has(layer)) return true;
				layer.dispose();
				return false;
			});
		},
		dispose() {
			for (const layer of retired) layer.dispose();
			for (const built of layers.values()) built.layer.dispose();
			retired = [];
			layers = new Map();
		},
	};
}

export function boardObjectVisible(
	id: string,
	hidden: ReadonlySet<FootprintLayer>,
): boolean {
	if (id === DRILL_LAYER_ID) return !hidden.has("F.Cu") || !hidden.has("B.Cu");
	const layer = layersByObjectId.get(id);
	return layer === undefined || !hidden.has(layer);
}
