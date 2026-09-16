import { transformPoint } from "./camera";
import {
	combinePolygons,
	GeometryCompiler,
	type MultiPolygon,
	triangulate,
} from "./geometry";
import type { SceneObject } from "./types";

export interface PlanarGeometry {
	positions: Float32Array;
	edges: Float32Array;
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

/** Resolve ordered exposures into real surfaces and their boundary segments. */
export function compilePlanarGeometry(
	objects: readonly SceneObject[],
	tolerance = 0.0001,
): PlanarGeometry {
	const compiler = new GeometryCompiler();
	let polygons: MultiPolygon = [];
	let pending: MultiPolygon = [];
	let polarity: "dark" | "clear" = "dark";
	const flush = () => {
		if (pending.length)
			polygons = combinePolygons(polygons, pending, polarity === "clear");
		pending = [];
	};
	for (const object of objects) {
		if (object.polarity !== polarity) {
			flush();
			polarity = object.polarity;
		}
		const matrix = object.transform;
		const scale = matrix
			? Math.max(
					Math.hypot(matrix[0], matrix[1]),
					Math.hypot(matrix[2], matrix[3]),
					1,
				)
			: 1;
		const compiled = compiler.compile(object.geometry, tolerance / scale);
		for (const polygon of compiled.polygons)
			pending.push(
				polygon.map((ring) =>
					ring.map(([x, y]) => {
						const point = transformPoint({ x, y }, matrix);
						return [point.x, point.y];
					}),
				),
			);
	}
	flush();
	const triangles = triangulate(polygons);
	const positions = new Float32Array((triangles.length / 2) * 3);
	for (let index = 0; index < triangles.length / 2; index++) {
		positions[index * 3] = triangles[index * 2];
		positions[index * 3 + 1] = triangles[index * 2 + 1];
	}
	const edges: number[] = [];
	for (const polygon of polygons)
		for (const ring of polygon)
			for (let index = 0; index < ring.length; index++) {
				const a = ring[index],
					b = ring[(index + 1) % ring.length];
				edges.push(a[0], a[1], 0, b[0], b[1], 0);
			}
	return { positions, edges: new Float32Array(edges) };
}
