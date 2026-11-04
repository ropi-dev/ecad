import {
	connectionTolerance,
	type EditorShape,
	PIN_RADIUS,
	resizeHandles,
} from "#/drawing/shapes.ts";
import type { Point } from "#/drawing/types.ts";

export interface WireCrossings {
	bridges: { offset: number; radius: number; side: number }[];
	gaps: { start: number; end: number }[];
}

export function buildWireCrossings(shapes: EditorShape[], junctions: Point[]) {
	const tolerance = connectionTolerance;
	const wires = shapes.flatMap((shape) => {
		if (shape.kind !== "wire" || shape.width <= tolerance) return [];
		const [start, end] = resizeHandles(shape);
		const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
		const axis = vertical ? "y" : "x";
		return [
			{
				shape,
				vertical,
				min: Math.min(start[axis], end[axis]),
				max: Math.max(start[axis], end[axis]),
				direction: end[axis] >= start[axis] ? 1 : -1,
			},
		];
	});
	const verticals = wires.filter((wire) => wire.vertical);
	const result = new Map<number, WireCrossings>();
	const forWire = (id: number) => {
		let crossing = result.get(id);
		if (!crossing) {
			crossing = { bridges: [], gaps: [] };
			result.set(id, crossing);
		}
		return crossing;
	};
	for (const horizontal of wires) {
		if (horizontal.vertical) continue;
		const { shape, min, max, direction } = horizontal;
		const crossings = verticals
			.filter(
				(vertical) =>
					vertical.shape.x > min + tolerance &&
					vertical.shape.x < max - tolerance &&
					shape.y > vertical.min + tolerance &&
					shape.y < vertical.max - tolerance &&
					!junctions.some(
						(point) =>
							Math.hypot(point.x - vertical.shape.x, point.y - shape.y) <=
							tolerance,
					),
			)
			.map((vertical) => {
				const x = vertical.shape.x;
				const radius = Math.min(
					Math.max(
						PIN_RADIUS * 3,
						shape.lineWidth * 2,
						vertical.shape.lineWidth * 2,
					),
					x - min,
					max - x,
					...junctions
						.filter((point) => Math.abs(point.y - shape.y) <= tolerance)
						.map((point) => Math.abs(point.x - x) / 2),
				);
				return { start: x - radius, end: x + radius, verticals: [vertical] };
			})
			.sort((a, b) => a.start - b.start);
		const groups: typeof crossings = [];
		for (const crossing of crossings) {
			const previous = groups.at(-1);
			if (previous && crossing.start <= previous.end + tolerance) {
				previous.end = Math.max(previous.end, crossing.end);
				previous.verticals.push(...crossing.verticals);
			} else groups.push(crossing);
		}
		for (const group of groups) {
			const center = (group.start + group.end) / 2;
			const radius = (group.end - group.start) / 2;
			forWire(shape.id).bridges.push({
				offset: (center - shape.x) * direction,
				radius,
				side: direction,
			});
			for (const vertical of group.verticals) {
				const dx = vertical.shape.x - center;
				const y = shape.y + Math.sqrt(Math.max(0, radius * radius - dx * dx));
				const offset = (y - vertical.shape.y) * vertical.direction;
				const clearance =
					(shape.lineWidth + vertical.shape.lineWidth) / 2 + PIN_RADIUS / 2;
				forWire(vertical.shape.id).gaps.push({
					start: offset - clearance,
					end: offset + clearance,
				});
			}
		}
	}
	return result;
}
