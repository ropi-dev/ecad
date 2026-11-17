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

type Openings = {
	top: [number, number][][];
	bottom: [number, number][][];
};

const shapeOpenings = new WeakMap<
	EditorShape,
	{ margin: number; openings: Openings }
>();

function openingsOf(shape: EditorShape, margin: number): Openings {
	const cached = shapeOpenings.get(shape);
	if (cached?.margin === margin) return cached.openings;
	const openings: Openings = { top: [], bottom: [] };
	const items = isBoardFootprint(shape)
		? (symbolShapes(shape) as EditorShape[])
		: [shape];
	for (const item of items) {
		if (!isPad(item) && !isHole(item)) continue;
		const layers = shapeLayers(item);
		const sides = (["top", "bottom"] as const).filter((side) =>
			layers.some(
				(layer) =>
					(isHole(item) ? layer : maskLayer[layer]) ===
					(side === "top" ? "F.Mask" : "B.Mask"),
			),
		);
		if (!sides.length) continue;
		const rings = shapeHulls(item)
			.map((hull) => hullPolygon(hull, margin))
			.filter((ring) => ring.length >= 3)
			.map((ring) => ring.map(({ x, y }): [number, number] => [x, y]));
		for (const side of sides) openings[side].push(...rings);
	}
	shapeOpenings.set(shape, { margin, openings });
	return openings;
}

/** @return Each side's pad and unplated hole openings in the solder mask, as the mask Gerber draws them. */
export function maskOpenings(
	shapes: readonly EditorShape[],
	margin = defaultBoardRules.solderMaskMargin,
): Openings {
	const openings: Openings = { top: [], bottom: [] };
	for (const shape of shapes) {
		const own = openingsOf(shape, margin);
		openings.top.push(...own.top);
		openings.bottom.push(...own.bottom);
	}
	return openings;
}
