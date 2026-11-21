import earcut from "earcut";
import {
	type CompiledGeometry,
	combinePolygons,
	GeometryCompiler,
	type MultiPolygon,
	triangulate,
} from "#/engine/geometry.ts";
import { partitionOverlaps } from "#/engine/partition-overlaps.ts";
import type { Bounds, SceneObject } from "#/engine/types.ts";

export interface PlanarGeometry {
	positions: Float32Array;
	edges: Float32Array;
	regions: PlanarRegion[];
	instances?: PlanarInstances[];
}

export interface PlanarInstances {
	positions: Float32Array;
	edges: Float32Array;
	offsets: Float32Array;
	regions: Uint32Array;
}

export interface PlanarRegion {
	/** Regions touching at a boundary vertex share a connected component. */
	component: number;
	start: number;
	count: number;
	edgeStart: number;
	edgeCount: number;
	bounds: Bounds;
}

export function simplifyPlanarEdges(edges: Float32Array, tolerance: number) {
	const result: number[] = [];
	const squaredTolerance = tolerance * tolerance;
	for (let start = 0; start < edges.length; ) {
		let end = start + 6;
		while (
			end < edges.length &&
			edges[end - 3] === edges[end] &&
			edges[end - 2] === edges[end + 1] &&
			(edges[end] !== edges[start] || edges[end + 1] !== edges[start + 1])
		)
			end += 6;
		const count = (end - start) / 6;
		const point = (index: number) =>
			index === count ? end - 3 : start + index * 6;
		const keep = new Set([0, count]);
		const pending = [[0, count]];
		while (pending.length) {
			const [first, last] = pending[pending.length - 1];
			pending.pop();
			const a = point(first),
				b = point(last);
			const dx = edges[b] - edges[a],
				dy = edges[b + 1] - edges[a + 1];
			const length = dx * dx + dy * dy;
			let furthest = -1;
			let distance = squaredTolerance;
			for (let index = first + 1; index < last; index++) {
				const p = point(index);
				const px = edges[p] - edges[a],
					py = edges[p + 1] - edges[a + 1];
				const t = length
					? Math.max(0, Math.min(1, (px * dx + py * dy) / length))
					: 0;
				const squared = (px - t * dx) ** 2 + (py - t * dy) ** 2;
				if (squared > distance) {
					distance = squared;
					furthest = index;
				}
			}
			if (furthest !== -1) {
				keep.add(furthest);
				pending.push([first, furthest], [furthest, last]);
			}
		}
		if (keep.size < 4) {
			for (let index = start; index < end; index++) result.push(edges[index]);
		} else {
			const indices = [...keep].sort((a, b) => a - b);
			for (let index = 1; index < indices.length; index++) {
				const a = point(indices[index - 1]),
					b = point(indices[index]);
				result.push(edges[a], edges[a + 1], 0, edges[b], edges[b + 1], 0);
			}
		}
		start = end;
	}
	return new Float32Array(result);
}

const MIN_INSTANCES = 16;

type Ring = [number, number][];

interface Resolved {
	polygons: MultiPolygon;
	vertices: Float64Array[];
	indices: number[][];
}

interface Prototype {
	polygons: MultiPolygon;
	bounds: Bounds;
	resolved?: Resolved;
	offsets: number[];
	regions: number[];
}

interface Exposure {
	prototype: Prototype;
	matrix: SceneObject["transform"];
	bounds: Bounds;
	polarity: "dark" | "clear";
}

const translate = (
	polygons: MultiPolygon,
	matrix: SceneObject["transform"],
): MultiPolygon =>
	matrix
		? polygons.map((polygon) =>
				polygon.map((ring) =>
					ring.map(([x, y]): [number, number] => [
						x + matrix[4],
						y + matrix[5],
					]),
				),
			)
		: polygons;

function prototypeOf(
	compiled: CompiledGeometry,
	matrix: SceneObject["transform"],
) {
	const bounds: Bounds = {
		minX: Infinity,
		minY: Infinity,
		maxX: -Infinity,
		maxY: -Infinity,
	};
	const polygons: MultiPolygon = compiled.polygons.map((polygon) =>
		polygon.map((ring) =>
			ring.map(([x, y]): [number, number] => {
				const point: [number, number] = matrix
					? [matrix[0] * x + matrix[2] * y, matrix[1] * x + matrix[3] * y]
					: [x, y];
				bounds.minX = Math.min(bounds.minX, point[0]);
				bounds.minY = Math.min(bounds.minY, point[1]);
				bounds.maxX = Math.max(bounds.maxX, point[0]);
				bounds.maxY = Math.max(bounds.maxY, point[1]);
				return point;
			}),
		),
	);
	return { polygons, bounds, offsets: [], regions: [] } satisfies Prototype;
}

function resolve(prototype: Prototype): Resolved {
	const polygons = combinePolygons([], prototype.polygons, false);
	const vertices: Float64Array[] = [];
	const indices: number[][] = [];
	for (const polygon of polygons) {
		const flat: number[] = [],
			holes: number[] = [];
		for (let index = 0; index < polygon.length; index++) {
			if (index) holes.push(flat.length / 2);
			for (const point of polygon[index]) flat.push(point[0], point[1]);
		}
		vertices.push(new Float64Array(flat));
		indices.push(earcut(flat, holes, 2));
	}
	return { polygons, vertices, indices };
}

const hashValue = new Float64Array(2);
const hashBits = new Uint32Array(hashValue.buffer);

function createPointTable(points: number) {
	let size = 16;
	while (size < points * 2) size *= 2;
	const mask = size - 1;
	const xs = new Float64Array(size);
	const ys = new Float64Array(size);
	const values = new Int32Array(size).fill(-1);
	return (x: number, y: number, value: number) => {
		hashValue[0] = x === 0 ? 0 : x;
		hashValue[1] = y === 0 ? 0 : y;
		let hash = Math.imul(
			hashBits[0] ^ Math.imul(hashBits[1], 0x9e3779b1),
			0x85ebca6b,
		);
		hash = Math.imul(
			hash ^ hashBits[2] ^ Math.imul(hashBits[3], 0x27d4eb2f),
			0xc2b2ae35,
		);
		hash ^= hash >>> 15;
		for (let slot = hash & mask; ; slot = (slot + 1) & mask) {
			const stored = values[slot];
			if (stored === -1) {
				xs[slot] = x;
				ys[slot] = y;
				values[slot] = value;
				return -1;
			}
			if (xs[slot] === x && ys[slot] === y) return stored;
		}
	};
}

/** Resolve ordered exposures into real surfaces and their boundary segments. */
export function compilePlanarGeometry(
	objects: readonly SceneObject[],
	tolerance = 0.0001,
): PlanarGeometry {
	const compiler = new GeometryCompiler();
	const prototypes = new Map<CompiledGeometry, Map<string, Prototype>>();
	const exposures: Exposure[] = [];
	for (const object of objects) {
		const matrix = object.transform;
		const scale = matrix
			? Math.max(
					Math.hypot(matrix[0], matrix[1]),
					Math.hypot(matrix[2], matrix[3]),
					1,
				)
			: 1;
		const compiled = compiler.compile(object.geometry, tolerance / scale);
		if (!compiled.polygons.length) continue;
		let shapes = prototypes.get(compiled);
		if (!shapes) {
			shapes = new Map();
			prototypes.set(compiled, shapes);
		}
		const linear = matrix
			? `${matrix[0]},${matrix[1]},${matrix[2]},${matrix[3]}`
			: "";
		let prototype = shapes.get(linear);
		if (!prototype) {
			prototype = prototypeOf(compiled, matrix);
			shapes.set(linear, prototype);
		}
		const local = prototype.bounds;
		exposures.push({
			prototype,
			matrix,
			bounds: matrix
				? {
						minX: local.minX + matrix[4],
						minY: local.minY + matrix[5],
						maxX: local.maxX + matrix[4],
						maxY: local.maxY + matrix[5],
					}
				: local,
			polarity: object.polarity,
		});
	}
	// Disjoint groups cannot affect one another. Keep exposure order within each
	// group so clear cutouts and later dark fills retain their original meaning.
	const polygons: MultiPolygon = [];
	const triangles: (
		| Float32Array
		| { vertices: Float64Array; indices: number[]; x: number; y: number }
	)[] = [];
	for (const group of partitionOverlaps(
		exposures.map((entry) => entry.bounds),
	)) {
		if (group.length === 1 && exposures[group[0]].polarity === "dark") {
			const { prototype, matrix } = exposures[group[0]];
			prototype.resolved ??= resolve(prototype);
			const { vertices, indices } = prototype.resolved;
			const x = matrix ? matrix[4] : 0,
				y = matrix ? matrix[5] : 0;
			prototype.offsets.push(x, y);
			prototype.regions.push(polygons.length);
			for (const polygon of translate(prototype.resolved.polygons, matrix))
				polygons.push(polygon);
			for (let index = 0; index < vertices.length; index++)
				triangles.push({
					vertices: vertices[index],
					indices: indices[index],
					x,
					y,
				});
			continue;
		}
		let resolved: MultiPolygon = [];
		let pending: MultiPolygon = [];
		let polarity: "dark" | "clear" = "dark";
		const flush = () => {
			if (pending.length)
				resolved = combinePolygons(resolved, pending, polarity === "clear");
			pending = [];
		};
		for (const index of group) {
			const exposure = exposures[index];
			if (exposure.polarity !== polarity) {
				flush();
				polarity = exposure.polarity;
			}
			for (const polygon of translate(
				exposure.prototype.polygons,
				exposure.matrix,
			))
				pending.push(polygon);
		}
		flush();
		for (const polygon of resolved) {
			polygons.push(polygon);
			triangles.push(triangulate([polygon]));
		}
	}
	const positions = new Float32Array(
		triangles.reduce(
			(count, entry) =>
				count +
				(entry instanceof Float32Array
					? (entry.length / 2) * 3
					: entry.indices.length * 3),
			0,
		),
	);
	let points = 0;
	for (const polygon of polygons)
		for (const ring of polygon) points += ring.length;
	const edges = new Float32Array(points * 6);
	let edgeOffset = 0;
	const regions: PlanarRegion[] = [];
	const parents = polygons.map((_, index) => index);
	const root = (index: number): number => {
		while (parents[index] !== index) {
			parents[index] = parents[parents[index]];
			index = parents[index];
		}
		return index;
	};
	const claim = createPointTable(points);
	let offset = 0;
	for (const [component, polygon] of polygons.entries()) {
		const triangle = triangles[component];
		const region: PlanarRegion = {
			component,
			start: offset,
			count:
				triangle instanceof Float32Array
					? triangle.length / 2
					: triangle.indices.length,
			edgeStart: edgeOffset,
			edgeCount: 0,
			bounds: {
				minX: Infinity,
				minY: Infinity,
				maxX: -Infinity,
				maxY: -Infinity,
			},
		};
		if (triangle instanceof Float32Array)
			for (let index = 0; index < region.count; index++) {
				positions[(offset + index) * 3] = triangle[index * 2];
				positions[(offset + index) * 3 + 1] = triangle[index * 2 + 1];
			}
		else {
			const { vertices, indices, x, y } = triangle;
			for (let index = 0; index < region.count; index++) {
				const at = indices[index] * 2;
				positions[(offset + index) * 3] = vertices[at] + x;
				positions[(offset + index) * 3 + 1] = vertices[at + 1] + y;
			}
		}
		offset += region.count;
		const { bounds } = region;
		for (const ring of polygon)
			for (let index = 0; index < ring.length; index++) {
				const a = ring[index],
					b = ring[(index + 1) % ring.length];
				const previous = claim(a[0], a[1], component);
				if (previous !== -1) parents[root(component)] = root(previous);
				bounds.minX = Math.min(bounds.minX, a[0]);
				bounds.minY = Math.min(bounds.minY, a[1]);
				bounds.maxX = Math.max(bounds.maxX, a[0]);
				bounds.maxY = Math.max(bounds.maxY, a[1]);
				edges[edgeOffset] = a[0];
				edges[edgeOffset + 1] = a[1];
				edges[edgeOffset + 3] = b[0];
				edges[edgeOffset + 4] = b[1];
				edgeOffset += 6;
			}
		region.edgeCount = edgeOffset - region.edgeStart;
		regions.push(region);
	}
	for (const region of regions) region.component = root(region.component);
	const instances: PlanarInstances[] = [];
	for (const shapes of prototypes.values())
		for (const prototype of shapes.values()) {
			const copies = prototype.regions.length;
			if (
				copies < MIN_INSTANCES ||
				!prototype.resolved ||
				!prototype.resolved.polygons.length
			)
				continue;
			const { polygons: local, vertices, indices } = prototype.resolved;
			instances.push({
				positions: localPositions(vertices, indices),
				edges: localEdges(local),
				offsets: new Float32Array(prototype.offsets),
				regions: new Uint32Array(
					prototype.regions.flatMap((first) =>
						local.map((_, index) => first + index),
					),
				),
			});
		}
	return {
		positions,
		edges,
		regions,
		...(instances.length ? { instances } : {}),
	};
}

function localPositions(vertices: Float64Array[], indices: number[][]) {
	const positions = new Float32Array(
		indices.reduce((count, entry) => count + entry.length * 3, 0),
	);
	let offset = 0;
	vertices.forEach((flat, polygon) => {
		for (const index of indices[polygon]) {
			positions[offset] = flat[index * 2];
			positions[offset + 1] = flat[index * 2 + 1];
			offset += 3;
		}
	});
	return positions;
}

function localEdges(polygons: MultiPolygon) {
	const rings: Ring[] = polygons.flat();
	const edges = new Float32Array(
		rings.reduce((count, ring) => count + ring.length * 6, 0),
	);
	let offset = 0;
	for (const ring of rings)
		for (let index = 0; index < ring.length; index++) {
			const a = ring[index],
				b = ring[(index + 1) % ring.length];
			edges[offset] = a[0];
			edges[offset + 1] = a[1];
			edges[offset + 3] = b[0];
			edges[offset + 4] = b[1];
			offset += 6;
		}
	return edges;
}
