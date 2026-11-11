import type { Attributes, Bounds } from "#/engine/types.ts";
import { emptyBounds, union } from "#/formats/gerber/geometry.ts";
import { classifyGerberLayer } from "#/formats/gerber/layer-order.ts";

export interface BoardPlacement {
	z: number;
	thickness: number;
	depthBias: number;
	through: boolean;
}

const BOARD_THICKNESS = 1.6;
const COPPER_Z = BOARD_THICKNESS / 2;
const COPPER_THICKNESS = 0.07;
const MASK_THICKNESS = 0.05;
const PASTE_THICKNESS = 0.04;
const LEGEND_THICKNESS = 0.04;
export const DRILL_WALL = COPPER_THICKNESS;

const surface = (
	below: number,
	thickness: number,
	depthBias: number,
): BoardPlacement => ({
	z: below + thickness,
	thickness,
	depthBias,
	through: false,
});
const mirror = (placement: BoardPlacement) => ({
	...placement,
	z: -placement.z,
});

const TOP_COPPER = surface(COPPER_Z, COPPER_THICKNESS, 0);
const TOP_MASK = surface(TOP_COPPER.z, MASK_THICKNESS, 1);
const TOP_PASTE = surface(TOP_MASK.z, PASTE_THICKNESS, 2);
const TOP_LEGEND = surface(TOP_PASTE.z, LEGEND_THICKNESS, 3);
const UNKNOWN = surface(TOP_LEGEND.z, LEGEND_THICKNESS, 4);
const PROFILE = { z: 0, thickness: 0, depthBias: 0, through: true };
const DRILL = {
	z: 0,
	thickness: 2 * TOP_LEGEND.z + 0.02,
	depthBias: 0,
	through: true,
};

const GROUPS: Readonly<Record<number, BoardPlacement>> = {
	0: TOP_LEGEND,
	1: TOP_PASTE,
	2: TOP_MASK,
	3: TOP_COPPER,
	5: mirror(TOP_COPPER),
	6: mirror(TOP_MASK),
	7: mirror(TOP_PASTE),
	8: mirror(TOP_LEGEND),
	9: PROFILE,
	10: DRILL,
};
const INNER_GROUP = 4;

const classify = (layer: { name: string; metadata: Attributes }) =>
	classifyGerberLayer(layer.name, layer.metadata[".FileFunction"]?.join(","));

export function boardOutline(
	layers: readonly { name: string; metadata: Attributes; bounds: Bounds }[],
): Bounds | undefined {
	const profiles = layers.filter(
		(layer) => GROUPS[classify(layer)[0]] === PROFILE,
	);
	const bounds = (profiles.length ? profiles : layers).reduce(
		(total, layer) => union(total, layer.bounds),
		emptyBounds(),
	);
	return Number.isFinite(bounds.minX) ? bounds : undefined;
}

export const isDrillLayer = (layer: { name: string; metadata: Attributes }) =>
	GROUPS[classify(layer)[0]] === DRILL;

export function placeBoardLayers(
	layers: readonly { name: string; metadata: Attributes }[],
): BoardPlacement[] {
	const orders = layers.map(classify);
	const inner = [
		...new Set(
			orders
				.filter(([group]) => group === INNER_GROUP)
				.map(([, layer]) => layer),
		),
	].sort((a, b) => a - b);
	return orders.map(([group, layer]) =>
		group === INNER_GROUP
			? {
					z:
						COPPER_Z -
						(BOARD_THICKNESS * (inner.indexOf(layer) + 1)) / (inner.length + 1),
					thickness: COPPER_THICKNESS,
					depthBias: 0,
					through: false,
				}
			: (GROUPS[group] ?? UNKNOWN),
	);
}
