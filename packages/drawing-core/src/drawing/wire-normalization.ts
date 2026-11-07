import { normalizationTolerance } from "#/drawing/connection-geometry.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import { drawShape, localToWorld } from "#/drawing/shape-geometry.ts";
import { pinTerminals } from "#/drawing/terminals.ts";
import type { Point } from "#/drawing/types.ts";
import { unionFind } from "#/lib/union-find.ts";

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
				vertical,
				coordinate: vertical ? shape.x : shape.y,
				min: Math.min(vertical ? start.y : start.x, vertical ? end.y : end.x),
				max: Math.max(vertical ? start.y : start.x, vertical ? end.y : end.x),
				forward: vertical ? end.y >= start.y : end.x >= start.x,
			},
		];
	});
	const sets = unionFind(wires.length);
	const junctions: Point[] = shapes.flatMap(pinTerminals);
	const visit = (first: number, second: number) => {
		const a = wires[first];
		const b = wires[second];
		if (a.vertical !== b.vertical) {
			const horizontal = a.vertical ? b : a;
			const vertical = a.vertical ? a : b;
			const x = vertical.coordinate;
			const y = horizontal.coordinate;
			if (
				x >= horizontal.min - normalizationTolerance &&
				x <= horizontal.max + normalizationTolerance &&
				y >= vertical.min - normalizationTolerance &&
				y <= vertical.max + normalizationTolerance &&
				(Math.abs(x - horizontal.min) <= normalizationTolerance ||
					Math.abs(x - horizontal.max) <= normalizationTolerance ||
					Math.abs(y - vertical.min) <= normalizationTolerance ||
					Math.abs(y - vertical.max) <= normalizationTolerance)
			)
				junctions.push({ x, y });
		}
		if (
			a.vertical === b.vertical &&
			a.shape.lineWidth === b.shape.lineWidth &&
			(a.shape.locked ?? false) === (b.shape.locked ?? false) &&
			Math.abs(a.coordinate - b.coordinate) <= normalizationTolerance &&
			a.min <= b.max + normalizationTolerance &&
			b.min <= a.max + normalizationTolerance
		)
			sets.union(second, first);
	};
	for (const [first, second] of candidatePairs(wires)) visit(first, second);
	const clusters = new Map<number, typeof wires>();
	for (const [index, wire] of wires.entries()) {
		const key = sets.find(index);
		const cluster = clusters.get(key) ?? [];
		cluster.push(wire);
		clusters.set(key, cluster);
	}
	const byX = sortedPoints(junctions, (point) => point.x);
	const byY = sortedPoints(junctions, (point) => point.y);
	const replacements = new Map<number, EditorShape[]>();
	const idMap = new Map<number, number>();
	const idsBySource = new Map<number, number[]>();
	for (const cluster of clusters.values()) {
		const survivor =
			cluster.find(({ shape }) => preferredIds.has(shape.id)) ?? cluster[0];
		const min = Math.min(...cluster.map((wire) => wire.min));
		const max = Math.max(...cluster.map((wire) => wire.max));
		// Pin terminals and wire endpoints create junctions. Bare crossings stay separate.
		const cuts = (survivor.vertical ? byX : byY)
			.near(survivor.coordinate)
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

const CELL = 10;
const MAX_CELLS = 256;

interface WireExtent {
	vertical: boolean;
	coordinate: number;
	min: number;
	max: number;
}

function candidatePairs(wires: readonly WireExtent[]): [number, number][] {
	const cells = new Map<string, number[]>();
	const wide: number[] = [];
	const ranges = wires.map((wire, index) => {
		const low = Math.floor((wire.min - normalizationTolerance) / CELL);
		const high = Math.floor((wire.max + normalizationTolerance) / CELL);
		const acrossLow = Math.floor(
			(wire.coordinate - normalizationTolerance) / CELL,
		);
		const acrossHigh = Math.floor(
			(wire.coordinate + normalizationTolerance) / CELL,
		);
		const [minX, maxX, minY, maxY] = wire.vertical
			? [acrossLow, acrossHigh, low, high]
			: [low, high, acrossLow, acrossHigh];
		const count = (maxX - minX + 1) * (maxY - minY + 1);
		if (
			![minX, maxX, minY, maxY].every(Number.isSafeInteger) ||
			count > MAX_CELLS
		) {
			wide.push(index);
			return undefined;
		}
		for (let x = minX; x <= maxX; x++)
			for (let y = minY; y <= maxY; y++) {
				const key = `${x},${y}`;
				const members = cells.get(key);
				if (members) members.push(index);
				else cells.set(key, [index]);
			}
		return { minX, maxX, minY, maxY };
	});
	const pairs: [number, number][] = [];
	for (const [key, members] of cells) {
		const [x, y] = key.split(",").map(Number);
		for (let i = 0; i < members.length; i++)
			for (let j = i + 1; j < members.length; j++) {
				const a = ranges[members[i]];
				const b = ranges[members[j]];
				if (
					!a ||
					!b ||
					x !== Math.max(a.minX, b.minX) ||
					y !== Math.max(a.minY, b.minY)
				)
					continue;
				pairs.push(
					members[i] < members[j]
						? [members[i], members[j]]
						: [members[j], members[i]],
				);
			}
	}
	const isWide = new Set(wide);
	for (const index of wide)
		for (let other = 0; other < wires.length; other++)
			if (other !== index && (!isWide.has(other) || other > index))
				pairs.push(index < other ? [index, other] : [other, index]);
	return pairs;
}

function sortedPoints(points: readonly Point[], key: (point: Point) => number) {
	const sorted = points
		.filter((point) => Number.isFinite(key(point)))
		.sort((a, b) => key(a) - key(b));
	const values = sorted.map(key);
	return {
		near(value: number): Point[] {
			const margin =
				2 * normalizationTolerance + 4 * Number.EPSILON * Math.abs(value);
			let low = 0;
			let high = values.length;
			while (low < high) {
				const middle = (low + high) >> 1;
				if (values[middle] < value - margin) low = middle + 1;
				else high = middle;
			}
			const result: Point[] = [];
			for (
				let index = low;
				index < values.length && values[index] <= value + margin;
				index++
			)
				result.push(sorted[index]);
			return result;
		},
	};
}
