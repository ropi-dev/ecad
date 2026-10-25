import type { Point } from "#/drawing/types.ts";

export const horizontalAlignments = ["left", "center", "right"] as const;
export const verticalAlignments = ["top", "middle", "bottom"] as const;

export interface TextAlignment {
	horizontalAlign?: (typeof horizontalAlignments)[number];
	verticalAlign?: (typeof verticalAlignments)[number];
}

export function textCenter(
	shape: Point &
		TextAlignment & { width: number; height: number; rotation: number },
): Point {
	const x =
		shape.horizontalAlign === "left"
			? shape.width / 2
			: shape.horizontalAlign === "right"
				? -shape.width / 2
				: 0;
	const y =
		shape.verticalAlign === "top"
			? -shape.height / 2
			: shape.verticalAlign === "bottom"
				? shape.height / 2
				: 0;
	return {
		x: shape.x + x * Math.cos(shape.rotation) - y * Math.sin(shape.rotation),
		y: shape.y + x * Math.sin(shape.rotation) + y * Math.cos(shape.rotation),
	};
}

export function validTextAlignment(value: TextAlignment): boolean {
	return (
		(value.horizontalAlign === undefined ||
			horizontalAlignments.includes(value.horizontalAlign)) &&
		(value.verticalAlign === undefined ||
			verticalAlignments.includes(value.verticalAlign))
	);
}
