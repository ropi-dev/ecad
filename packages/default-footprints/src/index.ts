import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import { catalog } from "./catalog.ts";
import { footprintModels } from "./models.ts";
import type { DefaultFootprint, SourceFootprint, SourceItem } from "./types.ts";

export type {
	DefaultFootprint,
	DefaultFootprintFile,
	SourceFootprint,
} from "./types.ts";

const padStroke = 0.15;
const arcStep = Math.PI / 12;
const round = (value: number) => Math.round(value * 1e9) / 1e9 || 0;
const radians = (degrees: number) => round((degrees * Math.PI) / 180);
type Point = readonly [number, number];
type ShapeWithoutId = EditorShape extends infer Shape
	? Shape extends EditorShape
		? Omit<Shape, "id">
		: never
	: never;

function line(
	layer: FootprintLayer,
	[x1, y1]: Point,
	[x2, y2]: Point,
	lineWidth: number,
): ShapeWithoutId[] {
	const dx = x2 - x1;
	const dy = y1 - y2;
	const length = Math.hypot(dx, dy);
	if (length < 0.001) return [];
	return [
		{
			kind: "line",
			layer,
			x: round((x1 + x2) / 2),
			y: round(-(y1 + y2) / 2),
			width: round(length),
			height: 1,
			rotation: round(Math.atan2(dy, dx)),
			lineWidth,
		},
	];
}

function outline(
	layer: FootprintLayer,
	points: readonly Point[],
	lineWidth: number,
	closed: boolean,
): ShapeWithoutId[] {
	const ends = closed ? [...points, points[0]] : points;
	return ends
		.slice(1)
		.flatMap((point, index) => line(layer, ends[index], point, lineWidth));
}

/** The circle through three points, sampled into segments of at most 15 degrees. */
function arc(start: Point, mid: Point, end: Point): Point[] {
	const [ax, ay] = start;
	const [bx, by] = mid;
	const [cx, cy] = end;
	const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
	if (Math.abs(d) < 1e-12) return [start, end];
	const ux =
		((ax ** 2 + ay ** 2) * (by - cy) +
			(bx ** 2 + by ** 2) * (cy - ay) +
			(cx ** 2 + cy ** 2) * (ay - by)) /
		d;
	const uy =
		((ax ** 2 + ay ** 2) * (cx - bx) +
			(bx ** 2 + by ** 2) * (ax - cx) +
			(cx ** 2 + cy ** 2) * (bx - ax)) /
		d;
	const radius = Math.hypot(ax - ux, ay - uy);
	const angle = ([x, y]: Point) => Math.atan2(y - uy, x - ux);
	const turn = (from: number, to: number) =>
		(((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
	const a0 = angle(start);
	const counterclockwise = turn(a0, angle(mid)) < turn(a0, angle(end));
	const sweep = counterclockwise ? turn(a0, angle(end)) : -turn(angle(end), a0);
	const steps = Math.max(1, Math.ceil(Math.abs(sweep) / arcStep));
	return Array.from({ length: steps + 1 }, (_, index) => {
		const a = a0 + (sweep * index) / steps;
		return [ux + radius * Math.cos(a), uy + radius * Math.sin(a)];
	});
}

/**
 * A filled isosceles triangle with a horizontal or vertical base, such as a
 * pin 1 marker, as a triangle shape. Other polygons have no matching shape.
 */
function triangle(
	layer: FootprintLayer,
	points: readonly Point[],
	lineWidth: number,
): ShapeWithoutId | undefined {
	if (points.length !== 3) return undefined;
	for (let apex = 0; apex < 3; apex++) {
		const [a, b] = points.filter((_, index) => index !== apex);
		const [px, py] = points[apex];
		const horizontal = Math.abs(a[1] - b[1]) < 1e-9;
		const vertical = Math.abs(a[0] - b[0]) < 1e-9;
		if (!horizontal && !vertical) continue;
		const mx = (a[0] + b[0]) / 2;
		const my = (a[1] + b[1]) / 2;
		if (horizontal ? Math.abs(px - mx) > 1e-9 : Math.abs(py - my) > 1e-9)
			continue;
		const dx = px - mx;
		const dy = my - py;
		return {
			kind: "triangle",
			layer,
			x: round((px + mx) / 2),
			y: round(-(py + my) / 2),
			width: round(Math.hypot(a[0] - b[0], a[1] - b[1])),
			height: round(Math.hypot(dx, dy)),
			rotation: round(Math.atan2(dy, dx) - Math.PI / 2),
			lineWidth,
			filled: true,
		};
	}
	return undefined;
}

function pad(
	shape: "rect" | "circle",
	x: number,
	y: number,
	width: number,
	height: number,
	angle: number,
) {
	return {
		kind: shape === "rect" ? ("rectangle" as const) : ("circle" as const),
		layer: "F.Cu" as const,
		x,
		y: round(-y),
		width,
		height: shape === "rect" ? height : width,
		rotation: shape === "rect" ? radians(angle) : 0,
		lineWidth: padStroke,
		filled: true,
	};
}

function convert(item: SourceItem): ShapeWithoutId[] {
	switch (item[0]) {
		case "smd": {
			const [, number, shape, x, y, width, height, angle, paste] = item;
			return [
				{
					...pad(shape, x, y, width, height, angle),
					pad: { number, type: "smd", ...(paste ? { paste } : {}) },
				},
			];
		}
		case "tht": {
			const [, number, shape, x, y, width, height, angle, drill] = item;
			return [
				{
					...pad(shape, x, y, width, height, angle),
					pad: { number, type: "through-hole", drill },
				},
			];
		}
		case "paste": {
			const [, x, y, width, height, angle] = item;
			return [
				{
					...pad("rect", x, y, width, height, angle),
					layer: "F.Paste",
				},
			];
		}
		case "line": {
			const [, layer, x1, y1, x2, y2, width] = item;
			return line(layer, [x1, y1], [x2, y2], width);
		}
		case "rect": {
			const [, layer, x1, y1, x2, y2, lineWidth, filled] = item;
			return [
				{
					kind: "rectangle",
					layer,
					x: round((x1 + x2) / 2),
					y: round(-(y1 + y2) / 2),
					width: round(Math.abs(x2 - x1)),
					height: round(Math.abs(y2 - y1)),
					rotation: 0,
					lineWidth,
					...(filled ? { filled } : {}),
				},
			];
		}
		case "circle": {
			const [, layer, x, y, radius, lineWidth, filled] = item;
			return [
				{
					kind: "circle",
					layer,
					x,
					y: round(-y),
					width: round(2 * radius),
					height: round(2 * radius),
					rotation: 0,
					lineWidth,
					...(filled ? { filled } : {}),
				},
			];
		}
		case "arc": {
			const [, layer, sx, sy, mx, my, ex, ey, width] = item;
			return outline(layer, arc([sx, sy], [mx, my], [ex, ey]), width, false);
		}
		case "poly": {
			const [, layer, width, filled, ...listed] = item;
			const first = listed[0];
			const last = listed[listed.length - 1];
			const points =
				listed.length > 3 && first[0] === last[0] && first[1] === last[1]
					? listed.slice(0, -1)
					: listed;
			const marker = filled ? triangle(layer, points, width) : undefined;
			return marker ? [marker] : outline(layer, points, width, true);
		}
	}
}

function generate(source: SourceFootprint): DefaultFootprint {
	const model = footprintModels[source.id];
	return {
		category: source.category,
		file: {
			format: "ecad-footprint",
			version: 1,
			units: "mm",
			id: source.id,
			name: source.name,
			description: source.description,
			...(model ? { model: { library: "builtin", id: model } } : {}),
			shapes: source.items
				.flatMap(convert)
				.map((shape, index) => ({ ...shape, id: index + 1 }) as EditorShape),
		},
	};
}

/** Generate fresh, deterministic footprints. Callers may edit their copies. */
export function generateDefaultFootprints(): DefaultFootprint[] {
	return catalog.map(generate);
}
