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
const COPPER_THICKNESS = 0.035;
const MASK_THICKNESS = 0.02;
const LEGEND_THICKNESS = 0.015;
const PASTE_THICKNESS = 0.1;
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
const TOP_LEGEND = surface(TOP_MASK.z, LEGEND_THICKNESS, 2);
const TOP_PASTE = surface(TOP_COPPER.z, PASTE_THICKNESS, 3);
export const BOARD_LEGEND_TOP = TOP_LEGEND.z;
export const BOARD_STACK_TOP = Math.max(TOP_LEGEND.z, TOP_PASTE.z);
const UNKNOWN = surface(BOARD_STACK_TOP, LEGEND_THICKNESS, 4);
const PROFILE = { z: 0, thickness: 0, depthBias: 0, through: true };
const DRILL = {
	z: 0,
	thickness: 2 * TOP_COPPER.z,
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

export const isUnplatedDrillLayer = (layer: {
	name: string;
	metadata: Attributes;
}) => {
	if (!isDrillLayer(layer)) return false;
	const fileFunction = layer.metadata[".FileFunction"];
	return fileFunction
		? fileFunction[0]?.toLowerCase() === "nonplated"
		: /(?:^|[._ -])npth(?:[._ -]|$)/i.test(layer.name);
};

export const BOARD_SUBSTRATE_TOP = COPPER_Z;
export const BOARD_COPPER_TOP = TOP_COPPER.z;
export const BOARD_MASK_TOP = TOP_MASK.z;

export type BoardLayerRole =
	| "copper"
	| "inner"
	| "mask"
	| "paste"
	| "legend"
	| "profile"
	| "drill"
	| "other";

const ROLES: Readonly<Record<number, readonly [BoardLayerRole, -1 | 0 | 1]>> = {
	0: ["legend", 1],
	1: ["paste", 1],
	2: ["mask", 1],
	3: ["copper", 1],
	4: ["inner", 0],
	5: ["copper", -1],
	6: ["mask", -1],
	7: ["paste", -1],
	8: ["legend", -1],
	9: ["profile", 0],
	10: ["drill", 0],
};

export function boardLayerRole(layer: { name: string; metadata: Attributes }): {
	role: BoardLayerRole;
	side: -1 | 0 | 1;
} {
	const [role, side] = ROLES[classify(layer)[0]] ?? ["other", 0];
	return { role, side };
}

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
