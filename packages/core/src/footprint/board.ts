import {
	type EditorShape,
	expandBounds,
	mergeBounds,
	shapeBounds,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import { isPad, shapeLayers } from "@ecad/drawing-core/footprint/shapes.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import type {
	Bounds,
	Geometry,
	Matrix,
	PlanarObject,
	SceneObject,
} from "#/engine/types.ts";
import { placeBoardLayers } from "#/formats/gerber/board-stack.ts";

const boardMargin = 1;
const boardEdgeWidth = 0.1;
export const DRILL_LAYER_ID = "footprint:drill";
export const BOARD_LAYER_ID = "footprint:board";

const gerberFileFunctions: readonly (readonly [FootprintLayer, string])[] = [
	["F.Cu", "Copper,L1,Top"],
	["B.Cu", "Copper,L2,Bot"],
	["F.SilkS", "Legend,Top"],
	["B.SilkS", "Legend,Bot"],
	["F.Mask", "Soldermask,Top"],
	["B.Mask", "Soldermask,Bot"],
	["F.Paste", "Paste,Top"],
	["B.Paste", "Paste,Bot"],
];
const boardLayers = new Map(gerberFileFunctions);
const layerObjectId = (layer: FootprintLayer) => `footprint:${layer}`;
const layersByObjectId = new Map(
	gerberFileFunctions.map(([layer]) => [layerObjectId(layer), layer]),
);

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
		metadata: { ".FileFunction": fileFunction.split(",") },
	};
}

export const boardEdgeBounds = (shapes: readonly EditorShape[]): Bounds =>
	expandBounds(mergeBounds(shapes.map(strokedBounds)), boardMargin);

export function footprintBoard(shapes: readonly EditorShape[]): PlanarObject[] {
	if (!shapes.length) return [];
	const objects = new Map<FootprintLayer, SceneObject[]>();
	const drills: SceneObject[] = [];
	for (const shape of shapes) {
		const geometry = shapeGeometry(shape);
		if (!geometry) continue;
		for (const layer of shapeLayers(shape)) {
			if (!boardLayers.has(layer)) continue;
			const onLayer = objects.get(layer) ?? [];
			onLayer.push({
				id: `${layer}:${shape.id}`,
				geometry,
				bounds: strokedBounds(shape),
				polarity: "dark",
				transform: placement(shape),
				attributes: {},
			});
			objects.set(layer, onLayer);
		}
		if (isPad(shape) && shape.pad.drill !== undefined) {
			const radius = shape.pad.drill / 2;
			drills.push({
				id: `drill:${shape.id}`,
				geometry: { type: "circle", x: shape.x, y: shape.y, radius },
				bounds: expandBounds(
					{ minX: shape.x, minY: shape.y, maxX: shape.x, maxY: shape.y },
					radius,
				),
				polarity: "dark",
				attributes: {},
			});
		}
	}
	const edge = boardEdgeBounds(shapes);
	const colors = darkSchematicTheme.appearance;
	return [
		planarLayer(BOARD_LAYER_ID, "Board edge", colors["F.Fab"], "Profile,NP", [
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
		]),
		...gerberFileFunctions.flatMap(([layer, fileFunction]) => {
			const onLayer = objects.get(layer);
			return onLayer
				? [
						planarLayer(
							layerObjectId(layer),
							layer,
							colors[layer],
							fileFunction,
							onLayer,
						),
					]
				: [];
		}),
		...(drills.length
			? [
					planarLayer(
						DRILL_LAYER_ID,
						"Drills",
						colors["pad-through"],
						"Plated,1,2,PTH",
						drills,
					),
				]
			: []),
	];
}

let layerHeights: Map<FootprintLayer, number> | undefined;

export function boardLayerHeight(layer: FootprintLayer): number {
	layerHeights ??= new Map(
		placeBoardLayers(
			gerberFileFunctions.map(([name, fileFunction]) => ({
				name,
				metadata: { ".FileFunction": fileFunction.split(",") },
			})),
		).map((placement, index) => [gerberFileFunctions[index][0], placement.z]),
	);
	return (
		layerHeights.get(layer) ??
		layerHeights.get(layer.startsWith("B.") ? "B.SilkS" : "F.SilkS") ??
		0
	);
}

export const boardShapeLayers = (
	shape: EditorShape,
): readonly FootprintLayer[] =>
	shapeGeometry(shape)
		? shapeLayers(shape).filter((layer) => boardLayers.has(layer))
		: [];

export function boardObjectVisible(
	id: string,
	hidden: ReadonlySet<FootprintLayer>,
): boolean {
	if (id === DRILL_LAYER_ID) return !hidden.has("F.Cu") || !hidden.has("B.Cu");
	const layer = layersByObjectId.get(id);
	return layer === undefined || !hidden.has(layer);
}
