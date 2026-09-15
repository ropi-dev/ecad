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
