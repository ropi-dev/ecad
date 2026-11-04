import type { Point } from "#/drawing/types.ts";

export const connectionTolerance = 1e-4;

export const normalizationTolerance = connectionTolerance;

const bucketOf = (value: number) => Math.floor(value);

export function createPointIndex<T>(
	items: readonly T[],
	pointOf: (item: T) => Point,
) {
	const buckets = new Map<number, Map<number, T[]>>();
	for (const item of items) {
		const point = pointOf(item);
		const x = bucketOf(point.x);
		const y = bucketOf(point.y);
		let column = buckets.get(x);
		if (!column) {
			column = new Map();
			buckets.set(x, column);
		}
		const entries = column.get(y);
		if (entries) entries.push(item);
		else column.set(y, [item]);
	}
	return (point: Point, test: (item: T) => boolean) => {
		const x = bucketOf(point.x);
		const y = bucketOf(point.y);
		for (let dx = -1; dx <= 1; dx++) {
			const column = buckets.get(x + dx);
			if (!column) continue;
			for (let dy = -1; dy <= 1; dy++)
				if (column.get(y + dy)?.some(test)) return true;
		}
		return false;
	};
}

export function createWireIndex<T extends { start: Point; end: Point }>(
	wires: readonly T[],
) {
	const rows = new Map<number, T[]>();
	const columns = new Map<number, T[]>();
	for (const wire of wires) {
		const vertical =
			Math.abs(wire.end.x - wire.start.x) < Math.abs(wire.end.y - wire.start.y);
		const index = vertical ? columns : rows;
		const key = bucketOf(vertical ? wire.start.x : wire.start.y);
		const entries = index.get(key);
		if (entries) entries.push(wire);
		else index.set(key, [wire]);
	}
	return (point: Point, test: (wire: T) => boolean) => {
		for (const [index, value] of [
			[rows, point.y],
			[columns, point.x],
		] as const) {
			const key = bucketOf(value);
			for (let offset = -1; offset <= 1; offset++)
				if (index.get(key + offset)?.some(test)) return true;
		}
		return false;
	};
}

export function pointOnWire(point: Point, start: Point, end: Point) {
	// Named axes keep this hot connection test free of keyed property lookups.
	if (Math.abs(end.x - start.x) < Math.abs(end.y - start.y))
		return (
			Math.abs(point.x - start.x) <= connectionTolerance &&
			point.y >= Math.min(start.y, end.y) - connectionTolerance &&
			point.y <= Math.max(start.y, end.y) + connectionTolerance
		);
	return (
		Math.abs(point.y - start.y) <= connectionTolerance &&
		point.x >= Math.min(start.x, end.x) - connectionTolerance &&
		point.x <= Math.max(start.x, end.x) + connectionTolerance
	);
}
