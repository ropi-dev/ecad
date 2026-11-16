import type { PlanarGeometry } from "#/engine/planar-geometry.ts";
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

export function realisticLayerStyle(
	role: BoardLayerRole,
	unplated = false,
): RealisticLayerStyle {
	if (role === "copper")
		return { visible: true, color: REALISTIC_COLORS.copper };
	if (role === "legend")
		return { visible: true, color: REALISTIC_COLORS.legend };
	if (role === "drill")
		return {
			visible: true,
			color: unplated
				? REALISTIC_COLORS.substrateEdge
				: REALISTIC_COLORS.plating,
		};
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

/** Closed rings as the edge list a hole mask paints from. */
export function ringGeometry(rings: readonly Ring[]): PlanarGeometry {
	const edges = new Float32Array(
		rings.reduce((count, ring) => count + ring.length * 6, 0),
	);
	let at = 0;
	for (const ring of rings)
		ring.forEach(([ax, ay], index) => {
			const [bx, by] = ring[(index + 1) % ring.length];
			edges.set([ax, ay, 0, bx, by, 0], at);
			at += 6;
		});
	return { positions: new Float32Array(), edges, regions: [] };
}
