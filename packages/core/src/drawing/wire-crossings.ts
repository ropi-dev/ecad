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

/** First index in an ascending list whose value passes `after`. */
function firstAfter<T>(
	items: readonly T[],
	of: (item: T) => number,
	after: (value: number) => boolean,
) {
	let low = 0;
	let high = items.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (after(of(items[middle]))) high = middle;
		else low = middle + 1;
	}
	return low;
}

/** Junctions on a wire's row, sorted by x for nearest-neighbor lookups. */
function junctionRows(junctions: Point[], tolerance: number) {
	const rows = new Map<number, Point[]>();
	for (const point of junctions) {
		const key = Math.floor(point.y);
		const row = rows.get(key);
		if (row) row.push(point);
		else rows.set(key, [point]);
	}
	return (y: number) => {
		// A row bucket is far wider than the tolerance, so neighbors hold every match.
		const key = Math.floor(y);
		const points: Point[] = [];
		// Past 2^53 neighboring keys round together, so visit each bucket once.
		for (const neighbor of new Set([key - 1, key, key + 1]))
			for (const point of rows.get(neighbor) ?? [])
				if (Math.abs(point.y - y) <= tolerance) points.push(point);
		// NaN positions do not sort, so such rows use the full scan.
		const sorted = points.every((point) => !Number.isNaN(point.x));
		if (sorted) points.sort((a, b) => a.x - b.x);
		return {
			/** Whether a junction lies within the tolerance of `x` on this row. */
			at: (x: number) => {
				if (!sorted)
					return points.some(
						(point) => Math.hypot(point.x - x, point.y - y) <= tolerance,
					);
				// Inclusive bounds, because x ± 2 × tolerance rounds to x at large x.
				const low = x - tolerance * 2;
				const high = x + tolerance * 2;
				for (
					let index = firstAfter(
						points,
						(point) => point.x,
						(value) => value >= low,
					);
					index < points.length && points[index].x <= high;
					index++
				)
					if (Math.hypot(points[index].x - x, points[index].y - y) <= tolerance)
						return true;
				return false;
			},
			/** Half the distance to the nearest junction on this row. */
			clearance: (x: number) => {
				if (!sorted)
					return Math.min(...points.map((point) => Math.abs(point.x - x) / 2));
				const index = firstAfter(
					points,
					(point) => point.x,
					(value) => value > x,
				);
				return Math.min(
					index > 0 ? Math.abs(points[index - 1].x - x) / 2 : Infinity,
					index < points.length ? Math.abs(points[index].x - x) / 2 : Infinity,
				);
			},
		};
	};
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
	// Verticals sit in every row band they strictly span, sorted by x, so each
	// horizontal wire visits only the verticals it can cross. A non-finite x never
	// lies strictly inside a span.
	const band = 10;
	const longest = 1000;
	const bands = new Map<number, (typeof wires)[number][]>();
	const unbanded: (typeof wires)[number][] = [];
	const indexes = new Map<(typeof wires)[number], number>();
	for (const wire of wires) {
		if (!wire.vertical) continue;
		indexes.set(wire, indexes.size);
		if (!Number.isFinite(wire.shape.x)) continue;
		const first = Math.floor((wire.min + tolerance) / band);
		const last = Math.floor((wire.max - tolerance) / band);
		// Long spans and band keys past 2^53, where `key++` stalls, scan unbanded.
		if (
			!Number.isSafeInteger(first) ||
			!Number.isSafeInteger(last) ||
			last - first > longest
		) {
			if (!(first > last)) unbanded.push(wire);
			continue;
		}
		for (let key = first; key <= last; key++) {
			const entries = bands.get(key);
			if (entries) entries.push(wire);
			else bands.set(key, [wire]);
		}
	}
	const byX = (a: (typeof wires)[number], b: (typeof wires)[number]) =>
		a.shape.x - b.shape.x;
	for (const entries of bands.values()) entries.sort(byX);
	unbanded.sort(byX);
	const junctionsOnRow = junctionRows(junctions, tolerance);
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
		const crossings: {
			start: number;
			end: number;
			index: number;
			verticals: (typeof wires)[number][];
		}[] = [];
		let row: ReturnType<typeof junctionsOnRow> | undefined;
		for (const candidates of [
			bands.get(Math.floor(shape.y / band)) ?? [],
			unbanded,
		])
			for (
				let index = firstAfter(
					candidates,
					(wire) => wire.shape.x,
					(value) => value > min + tolerance,
				);
				index < candidates.length &&
				candidates[index].shape.x < max - tolerance;
				index++
			) {
				const vertical = candidates[index];
				const x = vertical.shape.x;
				if (
					!(shape.y > vertical.min + tolerance) ||
					!(shape.y < vertical.max - tolerance)
				)
					continue;
				row ??= junctionsOnRow(shape.y);
				if (row.at(x)) continue;
				const radius = Math.min(
					Math.max(
						PIN_RADIUS * 3,
						shape.lineWidth * 2,
						vertical.shape.lineWidth * 2,
					),
					x - min,
					max - x,
					row.clearance(x),
				);
				crossings.push({
					start: x - radius,
					end: x + radius,
					index: indexes.get(vertical) ?? 0,
					verticals: [vertical],
				});
			}
		// Equal starts keep document order, as a stable sort of document order would.
		crossings.sort((a, b) => a.start - b.start || a.index - b.index);
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
