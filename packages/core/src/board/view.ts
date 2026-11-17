import {
	isZone,
	type RatsnestLine,
} from "@ecad/drawing-core/board/connectivity.ts";
import {
	type BoardFootprint,
	isBoardFootprint,
} from "@ecad/drawing-core/board/footprints.ts";
import {
	type EditorShape,
	type LineShape,
	symbolShapes,
	symbolTextShapes,
	type TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	footprintLayerView,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";

/** Display IDs of footprint items start here, clear of document IDs. */
const itemBase = 2 ** 40;
const itemsPerFootprint = 8192;
const ratsnestBase = 2 ** 51;

const footprintVisible = (
	footprint: BoardFootprint,
	hidden: ReadonlySet<FootprintLayer>,
) =>
	!hidden.has(footprint.layer ?? "F.SilkS") ||
	footprint.children.some((child) =>
		shapeLayers(child).some((layer) => !hidden.has(layer)),
	);

/**
 * The board's top-level items the editor can pick, bottom first: zones, then
 * footprints, then the other items in layer order with the active layer on
 * top. Items on hidden layers are left out.
 */
export function boardLayerView(
	shapes: readonly EditorShape[],
	hidden: ReadonlySet<FootprintLayer>,
	active: FootprintLayer,
): EditorShape[] {
	const zones: EditorShape[] = [];
	const footprints: BoardFootprint[] = [];
	const rest: EditorShape[] = [];
	for (const shape of shapes) {
		if (isBoardFootprint(shape)) {
			if (footprintVisible(shape, hidden)) footprints.push(shape);
		} else if (isZone(shape)) zones.push(shape);
		else rest.push(shape);
	}
	const activeSide = active.startsWith("B.");
	footprints.sort(
		(a, b) =>
			Number((a.flipped ?? false) === activeSide) -
			Number((b.flipped ?? false) === activeSide),
	);
	return [
		...footprintLayerView(zones, hidden, active),
		...footprints,
		...footprintLayerView(rest, hidden, active),
	];
}

export const footprintItemId = (footprintId: number, index: number) =>
	itemBase + footprintId * itemsPerFootprint + index + 1;

const expansions = new WeakMap<BoardFootprint, readonly EditorShape[]>();

function footprintDisplayItems(
	footprint: BoardFootprint,
): readonly EditorShape[] {
	const cached = expansions.get(footprint);
	if (cached) return cached;
	const base = itemBase + footprint.id * itemsPerFootprint;
	const items: EditorShape[] = symbolShapes(footprint).map(
		(child, index) =>
			({ ...child, id: footprintItemId(footprint.id, index) }) as EditorShape,
	);
	const layer = footprint.layer ?? "F.SilkS";
	for (const [index, text] of symbolTextShapes(footprint).entries())
		items.push({
			...(text as TextShape),
			id: base + itemsPerFootprint - 1 - index,
			layer,
		});
	expansions.set(footprint, items);
	return items;
}

interface BoardDisplay {
	shapes: EditorShape[];
	selected: ReadonlySet<number>;
}

/**
 * What the flat view draws: every item on a visible layer, with placed
 * footprints taken apart so each pad and line takes its layer's colour.
 */
export function boardDisplay(
	shapes: readonly EditorShape[],
	selected: ReadonlySet<number>,
	hidden: ReadonlySet<FootprintLayer>,
	active?: FootprintLayer,
): BoardDisplay {
	const flat: EditorShape[] = [];
	const shown = new Set(selected);
	for (const shape of shapes) {
		if (!isBoardFootprint(shape)) {
			flat.push(shape);
			continue;
		}
		const items = footprintDisplayItems(shape);
		for (const item of items) {
			flat.push(item);
			if (selected.has(shape.id)) shown.add(item.id);
		}
	}
	return {
		shapes: footprintLayerView(flat, hidden, active),
		selected: shown,
	};
}

export const boardExportShapes = (shapes: readonly EditorShape[]) =>
	boardDisplay(shapes, new Set(), new Set()).shapes;

const ratsnestWidth = 0.05;

export function ratsnestShapes(lines: readonly RatsnestLine[]): LineShape[] {
	return lines.flatMap((line, index): LineShape[] => {
		const dx = line.to.x - line.from.x;
		const dy = line.to.y - line.from.y;
		const length = Math.hypot(dx, dy);
		if (length < 1e-6) return [];
		return [
			{
				id: ratsnestBase + index,
				kind: "line",
				x: (line.from.x + line.to.x) / 2,
				y: (line.from.y + line.to.y) / 2,
				width: length,
				height: 1,
				rotation: Math.atan2(dy, dx),
				lineWidth: ratsnestWidth,
			},
		];
	});
}
