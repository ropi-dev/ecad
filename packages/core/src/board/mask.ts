import { isBoardFootprint } from "@ecad/drawing-core/board/footprints.ts";
import { hullPolygon, shapeHulls } from "@ecad/drawing-core/board/geometry.ts";
import { defaultBoardRules } from "@ecad/drawing-core/board/rules.ts";
import {
	type EditorShape,
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	isHole,
	isPad,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";

export const maskLayer: Partial<Record<FootprintLayer, FootprintLayer>> = {
	"F.Cu": "F.Mask",
	"B.Cu": "B.Mask",
};

/** @return Each side's pad and unplated hole openings in the solder mask, as the mask Gerber draws them. */
export function maskOpenings(
	shapes: readonly EditorShape[],
	margin = defaultBoardRules.solderMaskMargin,
): {
	top: [number, number][][];
	bottom: [number, number][][];
} {
	const openings = {
		top: [] as [number, number][][],
		bottom: [] as [number, number][][],
	};
	const items = shapes.flatMap((shape) =>
		isBoardFootprint(shape) ? (symbolShapes(shape) as EditorShape[]) : [shape],
	);
	for (const shape of items) {
		if (!isPad(shape) && !isHole(shape)) continue;
		const layers = shapeLayers(shape);
		const sides = (["top", "bottom"] as const).filter((side) =>
			layers.some(
				(layer) =>
					(isHole(shape) ? layer : maskLayer[layer]) ===
					(side === "top" ? "F.Mask" : "B.Mask"),
			),
		);
		if (!sides.length) continue;
		const rings = shapeHulls(shape)
			.map((hull) => hullPolygon(hull, margin))
			.filter((ring) => ring.length >= 3)
			.map((ring) => ring.map(({ x, y }): [number, number] => [x, y]));
		for (const side of sides) openings[side].push(...rings);
	}
	return openings;
}
