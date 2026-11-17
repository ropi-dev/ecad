import type {
	EditorShape,
	FillableShape,
	ShapeZone,
} from "#/drawing/schema.ts";
import { localToWorld } from "#/drawing/shape-geometry.ts";
import type { Point } from "#/drawing/types.ts";

export type PolygonZone = FillableShape & {
	zone: ShapeZone & { outline: readonly Point[] };
};

export const isPolygonZone = (shape: EditorShape): shape is PolygonZone =>
	shape.kind === "rectangle" && shape.zone?.outline !== undefined;

/** @return The corners of a polygon zone in board coordinates. */
export const zoneOutlinePoints = (shape: PolygonZone): Point[] =>
	shape.zone.outline.map((corner) =>
		localToWorld(shape, corner.x * shape.width, corner.y * shape.height),
	);

const minimumSize = 0.001;
const fraction = (value: number) => Math.max(-0.5, Math.min(0.5, value));

/**
 * @return `shape` as a polygon zone through `points`, in board coordinates,
 * with the rectangle refitted around them and its rotation kept.
 */
export function withZoneOutline<T extends FillableShape>(
	shape: T,
	points: readonly Point[],
): T {
	const cos = Math.cos(shape.rotation);
	const sin = Math.sin(shape.rotation);
	const local = points.map((point) => {
		const dx = point.x - shape.x;
		const dy = point.y - shape.y;
		return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
	});
	const xs = local.map((point) => point.x);
	const ys = local.map((point) => point.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const width = Math.max(maxX - minX, minimumSize);
	const height = Math.max(maxY - minY, minimumSize);
	const centerX = (minX + maxX) / 2;
	const centerY = (minY + maxY) / 2;
	return {
		...shape,
		...localToWorld(shape, centerX, centerY),
		width,
		height,
		zone: {
			...shape.zone,
			outline: local.map((point) => ({
				x: fraction((point.x - centerX) / width),
				y: fraction((point.y - centerY) / height),
			})),
		},
	};
}

/** @return The distance from `point` to the outline's edges, negative inside it by the even-odd rule. */
export function outlineOutsideBy(
	corners: readonly Point[],
	point: Point,
): number {
	let inside = false;
	let nearest = Infinity;
	for (let index = 0; index < corners.length; index++) {
		const a = corners[index];
		const b = corners[(index + 1) % corners.length];
		if (a.y > point.y !== b.y > point.y) {
			const crossing = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
			if (crossing > point.x) inside = !inside;
		}
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const length = dx * dx + dy * dy;
		const t = length
			? Math.max(
					0,
					Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
				)
			: 0;
		nearest = Math.min(
			nearest,
			Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy),
		);
	}
	return inside ? -nearest : nearest;
}
