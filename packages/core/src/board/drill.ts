import { isBoardFootprint } from "@ecad/drawing-core/board/footprints.ts";
import { hullPolygon } from "@ecad/drawing-core/board/geometry.ts";
import {
	type EditorShape,
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	type HoleShape,
	isHole,
	isPad,
	isVia,
	type PadShape,
	shapeHole,
	shapeLayers,
	type ViaShape,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { maskLayer } from "#/board/mask.ts";

export interface DrillHole {
	shape: PadShape | ViaShape | HoleShape;
	plated: boolean;
	diameter: number;
	ends: [Point, Point];
}

/** @return Every drilled hole on the board, in the order the Excellon files list them. */
export function drillHoles(shapes: readonly EditorShape[]): DrillHole[] {
	const holes: DrillHole[] = [];
	for (const shape of shapes) {
		const items = isBoardFootprint(shape)
			? (symbolShapes(shape) as EditorShape[])
			: [shape];
		for (const item of items) {
			if (!isPad(item) && !isVia(item) && !isHole(item)) continue;
			const hole = shapeHole(item);
			if (hole === undefined) continue;
			holes.push({ shape: item, plated: !isHole(item), ...hole });
		}
	}
	return holes;
}

const markStep = Math.PI / 32;

/** @return The hole's outline, as a flat list of x, y pairs. */
export function holeOutline({
	diameter,
	ends: [from, to],
}: DrillHole): number[] {
	const points = from.x === to.x && from.y === to.y ? [from] : [from, to];
	return hullPolygon({ points, radius: diameter / 2 }, 0, markStep).flatMap(
		({ x, y }) => [x, y],
	);
}

/**
 * @return Whether the hole's pad, via or mask opening is drawn on `layer`, so
 * the mark knocks it out; with no layer every hole goes through the stack.
 */
export function holeCutsLayer(
	{ shape }: DrillHole,
	layer: FootprintLayer | undefined,
): boolean {
	if (layer === undefined) return true;
	const layers = shapeLayers(shape);
	if (layers.includes(layer)) return true;
	return isPad(shape) && layers.some((on) => maskLayer[on] === layer);
}

/** @return Whether the hole gets a mark on `layer`: vias only where they are drawn. */
export const holeMarked = (
	hole: DrillHole,
	layer: FootprintLayer | undefined,
): boolean => !isVia(hole.shape) || holeCutsLayer(hole, layer);
