import { GeometryCompiler } from "#/engine/geometry.ts";
import {
	buildPlanarWalls,
	type PlanarWalls,
	writeSlabWalls,
} from "#/engine/planar-walls.ts";
import type { Bounds, Geometry, Matrix, SceneObject } from "#/engine/types.ts";

export interface PartMesh {
	triangles: Float32Array;
	edges: Float32Array;
}

export interface PlacedPart {
	mesh: PartMesh;
	transform?: Matrix;
}

export interface PartChanges {
	positions?: readonly [start: number, end: number];
	walls?: readonly [start: number, end: number];
	vacated?: Bounds;
}

export interface PartLayout {
	positions: Float32Array;
	edges: Float32Array;
	walls?: PlanarWalls;
	fits(index: number, mesh: PartMesh): boolean;
	replace(index: number, part: PlacedPart): void;
	takeChanges(): PartChanges;
}

export const PART_TOLERANCE = 0.0005;

const TRIANGLE_SIZE = 2;
const EDGE_SIZE = 4;
const POSITION_SIZE = 3;
const PLACED_EDGE_SIZE = 6;
const WALL_CORNERS = { slab: 6, barrel: 24 } as const;

const identities = new WeakMap<object, number>();
let nextIdentity = 1;

function identity(value: object) {
	let id = identities.get(value);
	if (id === undefined) {
		id = nextIdentity++;
		identities.set(value, id);
	}
	return id;
}

export function partKey(geometry: Geometry): string {
	if (geometry.type === "circle")
		return `c${geometry.x},${geometry.y},${geometry.radius}`;
	if (geometry.type === "rect")
		return `r${geometry.x},${geometry.y},${geometry.width},${geometry.height}`;
	if (geometry.type === "line")
		return `l${geometry.x1},${geometry.y1},${geometry.x2},${geometry.y2},${geometry.width}`;
	if (geometry.type === "path")
		return `p${geometry.fill ? 1 : 0},${geometry.strokeWidth ?? 0},${geometry.d}`;
	if (geometry.type === "polygons") return `P${identity(geometry.polygons)}`;
	return `g(${geometry.children
		.map(
			(child) =>
				`${child.polarity === "clear" ? "-" : "+"}${partKey(child.geometry)}`,
		)
		.join(";")})`;
}

const CACHE_LIMIT = 20_000;
const RING_SEGMENTS = { least: 16, most: 8192 };

type Children = Extract<Geometry, { type: "group" }>["children"];

function concentricRing(children: Children) {
	if (children.length !== 2) return undefined;
	const [outer, inner] = children;
	if (
		outer.polarity !== "dark" ||
		inner.polarity !== "clear" ||
		outer.geometry.type !== "circle" ||
		inner.geometry.type !== "circle" ||
		outer.geometry.x !== inner.geometry.x ||
		outer.geometry.y !== inner.geometry.y ||
		!(inner.geometry.radius > 0) ||
		!(outer.geometry.radius > inner.geometry.radius)
	)
		return undefined;
	return {
		x: outer.geometry.x,
		y: outer.geometry.y,
		outer: outer.geometry.radius,
		inner: inner.geometry.radius,
	};
}

function compileRing(
	ring: NonNullable<ReturnType<typeof concentricRing>>,
	tolerance: number,
): PartMesh {
	const step = 2 * Math.acos(Math.max(-1, 1 - tolerance / ring.outer));
	const count = Math.max(
		RING_SEGMENTS.least,
		Math.min(RING_SEGMENTS.most, Math.ceil((2 * Math.PI) / step)),
	);
	const triangles = new Float32Array(count * 6 * TRIANGLE_SIZE);
	const edges = new Float32Array(count * 2 * EDGE_SIZE);
	const point = (radius: number, index: number): [number, number] => {
		const angle = ((index % count) / count) * 2 * Math.PI;
		return [
			ring.x + radius * Math.cos(angle),
			ring.y + radius * Math.sin(angle),
		];
	};
	for (let index = 0; index < count; index++) {
		const a = point(ring.outer, index);
		const b = point(ring.outer, index + 1);
		const c = point(ring.inner, index + 1);
		const d = point(ring.inner, index);
		triangles.set([...a, ...b, ...c, ...a, ...c, ...d], index * 12);
		edges.set([...a, ...b], index * EDGE_SIZE);
		edges.set([...c, ...d], (2 * count - 1 - index) * EDGE_SIZE);
	}
	return { triangles, edges };
}

function join(parts: readonly PartMesh[]): PartMesh {
	const triangles = new Float32Array(
		parts.reduce((length, part) => length + part.triangles.length, 0),
	);
	const edges = new Float32Array(
		parts.reduce((length, part) => length + part.edges.length, 0),
	);
	let triangleOffset = 0;
	let edgeOffset = 0;
	for (const part of parts) {
		triangles.set(part.triangles, triangleOffset);
		edges.set(part.edges, edgeOffset);
		triangleOffset += part.triangles.length;
		edgeOffset += part.edges.length;
	}
	return { triangles, edges };
}

export function compilePart(
	geometry: Geometry,
	tolerance = PART_TOLERANCE,
): PartMesh {
	if (geometry.type === "group") {
		const ring = concentricRing(geometry.children);
		if (ring) return compileRing(ring, tolerance);
		if (geometry.children.every((child) => child.polarity === "dark"))
			return join(
				geometry.children.map((child) =>
					compilePart(child.geometry, tolerance),
				),
			);
	}
	const { polygons, vertices } = new GeometryCompiler().compile(
		geometry,
		tolerance,
	);
	let segments = 0;
	for (const polygon of polygons)
		for (const ring of polygon) segments += ring.length;
	const edges = new Float32Array(segments * EDGE_SIZE);
	let offset = 0;
	for (const polygon of polygons)
		for (const ring of polygon)
			for (let index = 0; index < ring.length; index++) {
				const from = ring[index];
				const to = ring[(index + 1) % ring.length];
				edges[offset++] = from[0];
				edges[offset++] = from[1];
				edges[offset++] = to[0];
				edges[offset++] = to[1];
			}
	return { triangles: vertices, edges };
}

export function createPartCache() {
	const cache = new Map<string, PartMesh>();
	return (geometry: Geometry): PartMesh => {
		if (geometry.type === "polygons") return compilePart(geometry);
		const key = partKey(geometry);
		let mesh = cache.get(key);
		if (!mesh) {
			mesh = compilePart(geometry);
			if (cache.size >= CACHE_LIMIT) {
				let excess = CACHE_LIMIT / 2;
				for (const stale of cache.keys()) {
					if (excess-- <= 0) break;
					cache.delete(stale);
				}
			}
			cache.set(key, mesh);
		}
		return mesh;
	};
}

export function partPlacement(object: SceneObject): {
	geometry: Geometry;
	transform?: Matrix;
} {
	const { geometry, transform } = object;
	if (
		(geometry.type !== "circle" && geometry.type !== "rect") ||
		(geometry.x === 0 && geometry.y === 0)
	)
		return { geometry, transform };
	const [a, b, c, d, e, f] = transform ?? [1, 0, 0, 1, 0, 0];
	return {
		geometry: { ...geometry, x: 0, y: 0 },
		transform: [
			a,
			b,
			c,
			d,
			a * geometry.x + c * geometry.y + e,
			b * geometry.x + d * geometry.y + f,
		],
	};
}

export function layoutParts(
	parts: readonly PlacedPart[],
	extrude?: PlanarWalls["extrude"],
	wall = 0,
): PartLayout {
	const count = parts.length;
	const cornerStart = new Uint32Array(count + 1);
	const edgeStart = new Uint32Array(count + 1);
	for (let index = 0; index < count; index++) {
		const { mesh } = parts[index];
		cornerStart[index + 1] =
			cornerStart[index] + mesh.triangles.length / TRIANGLE_SIZE;
		edgeStart[index + 1] = edgeStart[index] + mesh.edges.length / EDGE_SIZE;
	}
	const positions = new Float32Array(cornerStart[count] * POSITION_SIZE);
	const edges = new Float32Array(edgeStart[count] * PLACED_EDGE_SIZE);
	const place = (index: number, { mesh, transform }: PlacedPart) => {
		const [a, b, c, d, e, f] = transform ?? [1, 0, 0, 1, 0, 0];
		const { triangles, edges: local } = mesh;
		let out = cornerStart[index] * POSITION_SIZE;
		for (let at = 0; at < triangles.length; at += TRIANGLE_SIZE) {
			const x = triangles[at];
			const y = triangles[at + 1];
			positions[out] = a * x + c * y + e;
			positions[out + 1] = b * x + d * y + f;
			out += POSITION_SIZE;
		}
		out = edgeStart[index] * PLACED_EDGE_SIZE;
		for (let at = 0; at < local.length; at += EDGE_SIZE) {
			const x1 = local[at];
			const y1 = local[at + 1];
			const x2 = local[at + 2];
			const y2 = local[at + 3];
			edges[out] = a * x1 + c * y1 + e;
			edges[out + 1] = b * x1 + d * y1 + f;
			edges[out + 3] = a * x2 + c * y2 + e;
			edges[out + 4] = b * x2 + d * y2 + f;
			out += PLACED_EDGE_SIZE;
		}
	};
	for (let index = 0; index < count; index++) place(index, parts[index]);
	const walls = extrude && buildPlanarWalls(edges, extrude, wall);
	const wallSize = extrude ? WALL_CORNERS[extrude] * POSITION_SIZE : 0;
	let changedPositions: [number, number] | undefined;
	let changedWalls: [number, number] | undefined;
	let vacated: Bounds | undefined;
	const widen = (
		range: [number, number] | undefined,
		start: number,
		end: number,
	): [number, number] =>
		range ? [Math.min(range[0], start), Math.max(range[1], end)] : [start, end];
	return {
		positions,
		edges,
		walls,
		fits: (index, mesh) =>
			mesh.triangles.length / TRIANGLE_SIZE ===
				cornerStart[index + 1] - cornerStart[index] &&
			mesh.edges.length / EDGE_SIZE === edgeStart[index + 1] - edgeStart[index],
		replace(index, part) {
			vacated ??= {
				minX: Infinity,
				minY: Infinity,
				maxX: -Infinity,
				maxY: -Infinity,
			};
			for (
				let at = cornerStart[index] * POSITION_SIZE;
				at < cornerStart[index + 1] * POSITION_SIZE;
				at += POSITION_SIZE
			) {
				const x = positions[at];
				const y = positions[at + 1];
				if (x < vacated.minX) vacated.minX = x;
				if (x > vacated.maxX) vacated.maxX = x;
				if (y < vacated.minY) vacated.minY = y;
				if (y > vacated.maxY) vacated.maxY = y;
			}
			place(index, part);
			changedPositions = widen(
				changedPositions,
				cornerStart[index] * POSITION_SIZE,
				cornerStart[index + 1] * POSITION_SIZE,
			);
			if (!walls) return;
			const from = edgeStart[index];
			const to = edgeStart[index + 1];
			const placedEdges = edges.subarray(
				from * PLACED_EDGE_SIZE,
				to * PLACED_EDGE_SIZE,
			);
			if (walls.extrude === "slab")
				writeSlabWalls(placedEdges, walls.positions, from * wallSize);
			else {
				const rebuilt = buildPlanarWalls(placedEdges, walls.extrude, wall);
				walls.positions.set(rebuilt.positions, from * wallSize);
				if (walls.normals && rebuilt.normals)
					walls.normals.set(rebuilt.normals, from * wallSize);
			}
			changedWalls = widen(changedWalls, from * wallSize, to * wallSize);
		},
		takeChanges() {
			const changes = {
				positions: changedPositions,
				walls: changedWalls,
				vacated,
			};
			changedPositions = undefined;
			changedWalls = undefined;
			vacated = undefined;
			return changes;
		},
	};
}
