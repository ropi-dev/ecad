import { normalizationTolerance } from "#/drawing/connection-geometry.ts";
import { pageKey } from "#/drawing/pages.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import { drawShape, localToWorld } from "#/drawing/shape-geometry.ts";
import { pinTerminals } from "#/drawing/terminals.ts";
import type { Point } from "#/drawing/types.ts";
import { unionFind } from "#/lib/union-find.ts";

const BUCKET = normalizationTolerance * 10;
const bucketOf = (value: number) => Math.floor(value / BUCKET);

export function normalizeWireSegments(
	shapes: EditorShape[],
	preferredIds: ReadonlySet<number> = new Set(),
	nextShapeId = shapes.reduce(
		(maximum, shape) => Math.max(maximum, shape.id),
		0,
	) + 1,
): {
	shapes: EditorShape[];
	idMap: Map<number, number>;
	idsBySource: Map<number, number[]>;
	nextShapeId: number;
} {
	const wires = shapes.flatMap((shape, index) => {
		if (shape.kind !== "wire" || shape.width <= normalizationTolerance)
			return [];
		const start = localToWorld(shape, -shape.width / 2, 0);
		const end = localToWorld(shape, shape.width / 2, 0);
		const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
		return [
			{
				shape,
				index,
				page: pageKey(shape),
				vertical,
				coordinate: vertical ? shape.x : shape.y,
				min: Math.min(vertical ? start.y : start.x, vertical ? end.y : end.x),
				max: Math.max(vertical ? start.y : start.x, vertical ? end.y : end.x),
				forward: vertical ? end.y >= start.y : end.x >= start.x,
			},
		];
	});
	const sets = unionFind(wires.length);
	const lines = new Map<string, number[]>();
	const lineKey = (page: number, vertical: boolean, bucket: number) =>
		`${page}:${vertical ? "v" : "h"}:${bucket}`;
	for (const [index, wire] of wires.entries()) {
		const key = lineKey(wire.page, wire.vertical, bucketOf(wire.coordinate));
		const entries = lines.get(key);
		if (entries) entries.push(index);
		else lines.set(key, [index]);
	}
	const near = (
		page: number,
		vertical: boolean,
		coordinate: number,
		visit: (index: number) => void,
	) => {
		const bucket = bucketOf(coordinate);
		for (let offset = -1; offset <= 1; offset++)
			for (const index of lines.get(lineKey(page, vertical, bucket + offset)) ??
				[])
				visit(index);
	};
	// Wires on different pages never meet.
	const junctions: (Point & { page: number })[] = shapes.flatMap((shape) => {
		const page = pageKey(shape);
		return pinTerminals(shape).map((point) => ({ ...point, page }));
	});
	for (const [first, a] of wires.entries()) {
		near(a.page, a.vertical, a.coordinate, (second) => {
			if (second <= first) return;
			const b = wires[second];
			if (
				a.shape.lineWidth === b.shape.lineWidth &&
				(a.shape.locked ?? false) === (b.shape.locked ?? false) &&
				Math.abs(a.coordinate - b.coordinate) <= normalizationTolerance &&
				a.min <= b.max + normalizationTolerance &&
				b.min <= a.max + normalizationTolerance
			)
				sets.union(second, first);
		});
		// A crossing joins only where one wire ends on the other.
		for (const end of [a.min, a.max])
			near(a.page, !a.vertical, end, (other) => {
				const b = wires[other];
				if (
					Math.abs(b.coordinate - end) <= normalizationTolerance &&
					a.coordinate >= b.min - normalizationTolerance &&
					a.coordinate <= b.max + normalizationTolerance
				)
					junctions.push(
						a.vertical
							? { x: a.coordinate, y: b.coordinate, page: a.page }
							: { x: b.coordinate, y: a.coordinate, page: a.page },
					);
			});
	}
	const junctionLines = new Map<string, (Point & { page: number })[]>();
	for (const point of junctions)
		for (const vertical of [true, false]) {
			const key = lineKey(
				point.page,
				vertical,
				bucketOf(vertical ? point.x : point.y),
			);
			const entries = junctionLines.get(key);
			if (entries) entries.push(point);
			else junctionLines.set(key, [point]);
		}
	const junctionsNear = (
		page: number,
		vertical: boolean,
		coordinate: number,
	) => {
		const bucket = bucketOf(coordinate);
		return [-1, 0, 1].flatMap(
			(offset) =>
				junctionLines.get(lineKey(page, vertical, bucket + offset)) ?? [],
		);
	};
	const clusters = new Map<number, typeof wires>();
	for (const [index, wire] of wires.entries()) {
		const key = sets.find(index);
		const cluster = clusters.get(key) ?? [];
		cluster.push(wire);
		clusters.set(key, cluster);
	}
	const replacements = new Map<number, EditorShape[]>();
	const idMap = new Map<number, number>();
	const idsBySource = new Map<number, number[]>();
	for (const cluster of clusters.values()) {
		const survivor =
			cluster.find(({ shape }) => preferredIds.has(shape.id)) ?? cluster[0];
		const min = Math.min(...cluster.map((wire) => wire.min));
		const max = Math.max(...cluster.map((wire) => wire.max));
		// Pin terminals and wire endpoints create junctions. Bare crossings stay separate.
		const cuts = junctionsNear(
			survivor.page,
			survivor.vertical,
			survivor.coordinate,
		)
			.flatMap((point) => {
				const along = survivor.vertical ? point.y : point.x;
				const across = survivor.vertical ? point.x : point.y;
				return Math.abs(across - survivor.coordinate) <=
					normalizationTolerance &&
					along > min + normalizationTolerance &&
					along < max - normalizationTolerance
					? [along]
					: [];
			})
			.sort((a, b) => a - b)
			.filter(
				(value, index, values) =>
					index === 0 || value - values[index - 1] > normalizationTolerance,
			);
		if (cluster.length === 1 && cuts.length === 0) {
			idMap.set(survivor.shape.id, survivor.shape.id);
			idsBySource.set(survivor.shape.id, [survivor.shape.id]);
			replacements.set(cluster[0].index, [survivor.shape]);
			continue;
		}
		const point = (value: number): Point =>
			survivor.vertical
				? { x: survivor.coordinate, y: value }
				: { x: value, y: survivor.coordinate };
		const boundaries = [min, ...cuts, max];
		if (!survivor.forward) boundaries.reverse();
		const usedIds = new Set<number>();
		const segments = boundaries.slice(1).map((end, index) => {
			const start = boundaries[index];
			const sources = cluster.filter(
				(wire) =>
					Math.min(wire.max, Math.max(start, end)) -
						Math.max(wire.min, Math.min(start, end)) >
					normalizationTolerance,
			);
			const available = sources.filter(({ shape }) => !usedIds.has(shape.id));
			const source =
				available.find(({ shape }) => preferredIds.has(shape.id)) ??
				available[0];
			const id = source?.shape.id ?? nextShapeId++;
			usedIds.add(id);
			for (const { shape } of sources) {
				if (!idMap.has(shape.id)) idMap.set(shape.id, id);
				const ids = idsBySource.get(shape.id) ?? [];
				ids.push(id);
				idsBySource.set(shape.id, ids);
			}
			// Repeated commits must not rewrite untouched pieces through endpoint rounding.
			if (
				source &&
				source.forward === survivor.forward &&
				Math.abs(source.coordinate - survivor.coordinate) <= 1e-9 &&
				Math.abs(source.min - Math.min(start, end)) <= 1e-9 &&
				Math.abs(source.max - Math.max(start, end)) <= 1e-9
			)
				return source.shape;
			return {
				...drawShape(id, "wire", point(start), point(end)),
				...(survivor.shape.locked === undefined
					? {}
					: { locked: survivor.shape.locked }),
				...(survivor.shape.page === undefined
					? {}
					: { page: survivor.shape.page }),
				lineWidth: survivor.shape.lineWidth,
			};
		});
		// Keep retained source IDs mapped to themselves, even if they span several pieces.
		for (const { id } of segments)
			if (cluster.some(({ shape }) => shape.id === id)) idMap.set(id, id);
		replacements.set(cluster[0].index, segments);
	}
	return {
		shapes: shapes.flatMap((shape, index) => {
			if (shape.kind !== "wire") {
				idMap.set(shape.id, shape.id);
				idsBySource.set(shape.id, [shape.id]);
				return [shape];
			}
			const replacement = replacements.get(index);
			return replacement ?? [];
		}),
		idMap,
		idsBySource,
		nextShapeId,
	};
}
