import type { Bounds, MultiPolygon } from "#/engine/types.ts";
import type { BoardLayerRole } from "#/formats/gerber/board-stack.ts";

export type Ring = [number, number][];

export interface MaskOpenings {
	top: readonly Ring[];
	bottom: readonly Ring[];
}

/** A board's outline, and the pad openings its mask layers do not draw. */
export interface BoardShape {
	outline: MultiPolygon;
	openings: MaskOpenings;
}

export const REALISTIC_COLORS = {
	substrateEdge: "#c9bd8a",
	substrateFace: "#7d6c35",
	mask: "#13703a",
	copper: "#d8b04a",
	legend: "#f4f4ef",
	plating: "#cfa543",
} as const;

export interface RealisticLayerStyle {
	visible: boolean;
	color?: string;
}

export function realisticLayerStyle(role: BoardLayerRole): RealisticLayerStyle {
	if (role === "copper")
		return { visible: true, color: REALISTIC_COLORS.copper };
	if (role === "legend")
		return { visible: true, color: REALISTIC_COLORS.legend };
	if (role === "drill")
		return { visible: true, color: REALISTIC_COLORS.plating };
	return { visible: false };
}

export const boundsPolygon = ({
	minX,
	minY,
	maxX,
	maxY,
}: Bounds): MultiPolygon => [
	[
		[
			[minX, minY],
			[maxX, minY],
			[maxX, maxY],
			[minX, maxY],
		],
	],
];
