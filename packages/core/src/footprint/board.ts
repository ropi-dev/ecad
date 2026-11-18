import {
	type EditorShape,
	expandBounds,
	mergeBounds,
	shapeBounds,
	type TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	boardCopperLayers,
	copperLayerFunction,
	type FootprintLayer,
	isCopperLayer,
	isInnerCopperLayer,
	maxCopperLayers,
} from "@ecad/drawing-core/footprint/layers.ts";
import {
	footprintFitBounds,
	isDrilled,
	isHole,
	isPad,
	type PadShape,
	padCornerRadius,
	shapeDrill,
	shapeHole,
	shapeLayer,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";
import {
	type SchematicTheme,
	schematicTheme,
} from "#/drawing/schematic-theme.ts";
import type {
	Bounds,
	Geometry,
	Matrix,
	MultiPolygon,
	PlanarObject,
	SceneObject,
} from "#/engine/types.ts";
import {
	BOARD_LEGEND_TOP,
	BOARD_STACK_TOP,
	type BoardPlacement,
	placeBoardLayers,
} from "#/formats/gerber/board-stack.ts";

const boardMargin = 1;
const boardEdgeWidth = 0.1;
const drawingGap = 0.02;
export const DRILL_LAYER_ID = "footprint:drill";
export const NPTH_LAYER_ID = "footprint:npth";
export const BOARD_LAYER_ID = "footprint:board";

const surfaceLayers: readonly (readonly [FootprintLayer, string])[] = [
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
const copperStack = (count: number) =>
	boardCopperLayers(count).map(
		(layer) => [layer, copperLayerFunction(layer, count)] as const,
	);
const layerLists = new Map<
	number,
	readonly (readonly [FootprintLayer, string])[]
>();
const boardLayers = (count: number) => {
	let layers = layerLists.get(count);
	if (!layers) {
		layers = [
			...copperStack(count),
			...surfaceLayers,
			...drawingLayers.map(
				([layer, fileFunction]) => [layer, fileFunction] as const,
			),
		];
		layerLists.set(count, layers);
	}
	return layers;
};
const fileFunctionAttribute = (fileFunction: string) => ({
	".FileFunction": fileFunction.split(","),
});
const fixedPlacements: readonly (readonly [string, BoardPlacement])[] = [
	...[...copperStack(2), ...surfaceLayers].map(
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
];
const placementMaps = new Map<number, ReadonlyMap<string, BoardPlacement>>();
function placementsFor(count: number): ReadonlyMap<string, BoardPlacement> {
	let placements = placementMaps.get(count);
	if (!placements) {
		const inner = boardCopperLayers(count).slice(1, -1);
		const placed = placeBoardLayers(
			inner.map((layer) => ({
				name: layer,
				metadata: fileFunctionAttribute(copperLayerFunction(layer, count)),
			})),
		);
		placements = new Map([
			...fixedPlacements,
			...inner.map((layer, index) => [layer, placed[index]] as const),
		]);
		placementMaps.set(count, placements);
	}
	return placements;
}
function padNumberLayerName(layer: FootprintLayer) {
	return `${layer} pad numbers`;
}
const layerObjectId = (layer: FootprintLayer) => `footprint:${layer}`;
const textObjectId = (layer: FootprintLayer) => `footprint:${layer}:text`;
const padNumberObjectId = (layer: FootprintLayer) =>
	`footprint:${layer}:pad-numbers`;
const layersByObjectId = new Map([
	...boardLayers(maxCopperLayers).flatMap(([layer]) => [
		[layerObjectId(layer), layer] as const,
		[textObjectId(layer), layer] as const,
	]),
	...padNumberSides.map(
		([layer]) => [padNumberObjectId(layer), layer] as const,
	),
]);

export const BOARD_SURFACE_Z = BOARD_LEGEND_TOP;

const placers = new Map<number, typeof placeBoardLayers>();

/** @return Places the 3D layers of a board with `copperLayers` copper layers. */
export function footprintBoardPlacer(
	copperLayers = 2,
): typeof placeBoardLayers {
	let placer = placers.get(copperLayers);
	if (!placer) {
		const placements = placementsFor(copperLayers);
		placer = (layers) => {
			const stack = placeBoardLayers(layers);
			return layers.map(
				(layer, index) => placements.get(layer.name) ?? stack[index],
			);
		};
		placers.set(copperLayers, placer);
	}
	return placer;
}

export const placeFootprintBoard = footprintBoardPlacer();

export function layerSurfaceZ(
	layers: readonly FootprintLayer[],
	hidden: ReadonlySet<FootprintLayer>,
	eyeZ: number,
	copperLayers = 2,
): number {
	const placements = placementsFor(copperLayers);
	const present = layers.filter(
		(layer) => !isInnerCopperLayer(layer) || placements.has(layer),
	);
	const shown = present.filter((layer) => !hidden.has(layer));
	const heights = (shown.length ? shown : present).map(
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

function rectangleGeometry(
	{ minX, minY, maxX, maxY }: Bounds,
	lineWidth: number,
	filled: boolean,
): Geometry {
	const corners = [
		[minX, minY],
		[maxX, minY],
		[maxX, maxY],
		[minX, maxY],
	];
	return {
		type: "group",
		children: [
			...(filled
				? [
						{
							geometry: {
								type: "rect" as const,
								x: (minX + maxX) / 2,
								y: (minY + maxY) / 2,
								width: maxX - minX,
								height: maxY - minY,
							},
							polarity: "dark" as const,
						},
					]
				: []),
			...(lineWidth > 0
				? corners.map(([x1, y1], index) => {
						const [x2, y2] = corners[(index + 1) % corners.length];
						return {
							geometry: {
								type: "line" as const,
								x1,
								y1,
								x2,
								y2,
								width: lineWidth,
							},
							polarity: "dark" as const,
						};
					})
				: []),
		],
	};
}

function roundedRectanglePath(width: number, height: number, radius: number) {
	const x = width / 2;
	const y = height / 2;
	const arc = (toX: number, toY: number) =>
		`A${radius} ${radius} 0 0 1 ${toX} ${toY}`;
	return [
		`M${-x + radius} ${-y}`,
		`H${x - radius}`,
		arc(x, -y + radius),
		`V${y - radius}`,
		arc(x - radius, y),
		`H${-x + radius}`,
		arc(-x, y - radius),
		`V${-y + radius}`,
		arc(-x + radius, -y),
		"Z",
	].join(" ");
}

function shapeGeometry(shape: EditorShape): Geometry | undefined {
	const { width, height, lineWidth } = shape;
	if (shape.kind === "line")
		return {
			type: "line",
			x1: -width / 2,
			y1: 0,
			x2: width / 2,
			y2: 0,
			width: lineWidth,
		};
	if (shape.kind === "circle") {
		const radius = width / 2;
		if (isDrilled(shape)) return { type: "circle", x: 0, y: 0, radius };
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
	if (shape.kind === "rectangle" && isPad(shape)) {
		const radius = padCornerRadius(shape);
		return radius > 0
			? {
					type: "path",
					d: roundedRectanglePath(width, height, radius),
					fill: true,
				}
			: { type: "rect", x: 0, y: 0, width, height };
	}
	if (shape.kind === "rectangle")
		return rectangleGeometry(
			{
				minX: -width / 2,
				minY: -height / 2,
				maxX: width / 2,
				maxY: height / 2,
			},
			lineWidth,
			shape.filled === true,
		);
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

const hasGeometry = (shape: EditorShape) =>
	shape.kind === "line" ||
	shape.kind === "circle" ||
	shape.kind === "rectangle" ||
	shape.kind === "triangle";

const strokedBounds = (shape: EditorShape) =>
	expandBounds(
		shapeBounds(shape),
		isDrilled(shape) || shape.kind === "line" || shape.kind === "text"
			? 0
			: shape.lineWidth / 2,
	);

const EDGE_GROUP = "#edge";
const DRILL_GROUP = "#drill";
const shapeObjects = new WeakMap<EditorShape, Map<string, SceneObject[]>>();

function cachedObjects(
	shape: EditorShape,
	group: string,
	create: () => SceneObject[],
): SceneObject[] {
	let groups = shapeObjects.get(shape);
	if (!groups) {
		groups = new Map();
		shapeObjects.set(shape, groups);
	}
	let objects = groups.get(group);
	if (!objects) {
		objects = create();
		groups.set(group, objects);
	}
	return objects;
}

const layerObjects = (shape: EditorShape, layer: FootprintLayer) =>
	cachedObjects(shape, layer, () => {
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
	});

const edgeObjects = (shape: EditorShape) =>
	cachedObjects(shape, EDGE_GROUP, () => {
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
	});

const drillObjects = (shape: EditorShape) =>
	cachedObjects(shape, DRILL_GROUP, () => {
		const hole = shapeHole(shape);
		if (hole === undefined) return [];
		const radius = hole.diameter / 2;
		const [from, to] = hole.ends;
		return [
			{
				id: `drill:${shape.id}`,
				geometry:
					from.x === to.x && from.y === to.y
						? { type: "circle", x: shape.x, y: shape.y, radius }
						: {
								type: "line",
								x1: from.x,
								y1: from.y,
								x2: to.x,
								y2: to.y,
								width: hole.diameter,
							},
				bounds: expandBounds(
					{
						minX: Math.min(from.x, to.x),
						minY: Math.min(from.y, to.y),
						maxX: Math.max(from.x, to.x),
						maxY: Math.max(from.y, to.y),
					},
					radius,
				),
				polarity: "dark",
				attributes: {},
			},
		];
	});

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
	polygons: MultiPolygon;
	triangles?: Float32Array;
}

interface BoardPlanOptions {
	regions?: readonly BoardRegion[];
	colors?: SchematicTheme["appearance"];
	copperLayers?: number;
}

const regionBounds = (polygons: MultiPolygon): Bounds => {
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

const regionObjects = new WeakMap<BoardRegion, SceneObject>();

function regionObject(region: BoardRegion, id: string): SceneObject {
	let object = regionObjects.get(region);
	if (object?.id !== id) {
		object = {
			id,
			geometry: {
				type: "polygons",
				polygons: region.polygons,
				...(region.triangles?.length ? { triangles: region.triangles } : {}),
			},
			bounds: regionBounds(region.polygons),
			polarity: "dark",
			attributes: {},
		};
		regionObjects.set(region, object);
	}
	return object;
}

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
	const unplated: EditorShape[] = [];
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
		if (!hasGeometry(shape) || shape.layer === "Edge.Cuts") continue;
		if (shape.kind === "rectangle" && shape.zone) continue;
		for (const layer of shapeLayers(shape)) {
			const onLayer = members.get(layer) ?? [];
			onLayer.push(shape);
			members.set(layer, onLayer);
		}
		if (isHole(shape)) unplated.push(shape);
		else if (shapeDrill(shape) !== undefined) drilled.push(shape);
	}
	const edge = boardEdgeBounds(shapes);
	const colors = options.colors ?? schematicTheme().appearance;
	const copperLayers = options.copperLayers ?? 2;
	const layers = boardLayers(copperLayers);
	const placements = placementsFor(copperLayers);
	const boardEdgeObjects = (): SceneObject[] =>
		outline.length
			? outline.flatMap(edgeObjects)
			: [
					{
						id: "board-edge",
						geometry: rectangleGeometry(edge, boardEdgeWidth, false),
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
					boardEdgeObjects(),
				),
		},
		...layers.flatMap(([layer, fileFunction]): BoardLayerPlan[] => {
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
										...layerRegions.map((region, index) =>
											regionObject(region, `${layer}:region:${index}`),
										),
										...(onLayer ?? []).flatMap((shape) =>
											layerObjects(shape, layer),
										),
									],
								),
						},
					]
				: [];
		}),
		...layers.flatMap(([layer, fileFunction]): BoardLayerPlan[] => {
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
								`Plated,1,${copperLayers},PTH`,
								drilled.flatMap(drillObjects),
							),
					},
				]
			: []),
		...(unplated.length
			? [
					{
						id: NPTH_LAYER_ID,
						source: unplated,
						extrude: "barrel" as const,
						build: () =>
							planarLayer(
								NPTH_LAYER_ID,
								"Unplated holes",
								colors["pad-hole"],
								`NonPlated,1,${copperLayers},NPTH`,
								unplated.flatMap(drillObjects),
							),
					},
				]
			: []),
	];
}

export const sameSource = (a: BoardLayerSource, b: BoardLayerSource) =>
	a.length === b.length && a.every((item, index) => item === b[index]);

export function createBoardBuilder<Layer extends { dispose(): void }>(
	buildLayer: (plan: BoardLayerPlan, previous?: Layer) => Layer,
) {
	type Built = { source: BoardLayerSource; layer: Layer };
	let layers = new Map<string, Built>();
	let retired: Layer[] = [];
	let builtColors: SchematicTheme["appearance"] | undefined;
	return {
		build(shapes: readonly EditorShape[], options?: BoardPlanOptions): Layer[] {
			const next = new Map<string, Built>();
			const colors = options?.colors ?? schematicTheme().appearance;
			const recoloured = colors !== builtColors;
			try {
				for (const plan of planFootprintBoard(shapes, { ...options, colors })) {
					const kept = layers.get(plan.id);
					if (kept && !recoloured && sameSource(kept.source, plan.source)) {
						next.set(plan.id, kept);
						continue;
					}
					const layer = buildLayer(plan, recoloured ? undefined : kept?.layer);
					if (kept && layer === kept.layer) {
						kept.source = plan.source;
						next.set(plan.id, kept);
					} else next.set(plan.id, { source: plan.source, layer });
				}
			} catch (cause) {
				for (const [id, built] of next)
					if (layers.get(id) !== built) built.layer.dispose();
				throw cause;
			}
			for (const [id, built] of layers)
				if (next.get(id) !== built) retired.push(built.layer);
			layers = next;
			builtColors = colors;
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

export function boardObjectOnLayer(id: string, layer: FootprintLayer) {
	if (id === DRILL_LAYER_ID) return isCopperLayer(layer);
	if (id === NPTH_LAYER_ID) return layer === "F.Mask" || layer === "B.Mask";
	if (id === BOARD_LAYER_ID) return layer === "Edge.Cuts";
	return layersByObjectId.get(id) === layer;
}

export function boardObjectVisible(
	id: string,
	hidden: ReadonlySet<FootprintLayer>,
	copperLayers = 2,
): boolean {
	if (id === DRILL_LAYER_ID)
		return boardCopperLayers(copperLayers).some((layer) => !hidden.has(layer));
	if (id === NPTH_LAYER_ID)
		return !hidden.has("F.Mask") || !hidden.has("B.Mask");
	const layer = layersByObjectId.get(id);
	return layer === undefined || !hidden.has(layer);
}
