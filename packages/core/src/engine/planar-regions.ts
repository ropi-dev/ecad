import type { PlanarGeometry } from "./planar-geometry";
import type { Point } from "./types";

/** Pick resolved coverage, so cutouts break connections and holes remain empty. */
export function pickPlanarRegion(
	geometry: PlanarGeometry,
	point: Point,
	tolerance: number,
): number | undefined {
	const { edges } = geometry;
	let nearest: number | undefined;
	let distance = tolerance * tolerance;
	for (const region of geometry.regions) {
		const { bounds } = region;
		if (
			point.x < bounds.minX - tolerance ||
			point.x > bounds.maxX + tolerance ||
			point.y < bounds.minY - tolerance ||
			point.y > bounds.maxY + tolerance
		)
			continue;
		let inside = false;
		for (
			let index = region.edgeStart;
			index < region.edgeStart + region.edgeCount;
			index += 6
		) {
			const ax = edges[index],
				ay = edges[index + 1],
				bx = edges[index + 3],
				by = edges[index + 4];
			if (
				ay > point.y !== by > point.y &&
				point.x < ((bx - ax) * (point.y - ay)) / (by - ay) + ax
			)
				inside = !inside;
			const dx = bx - ax,
				dy = by - ay;
			const length = dx * dx + dy * dy;
			const t = length
				? Math.max(
						0,
						Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / length),
					)
				: 0;
			const squared =
				(point.x - ax - t * dx) ** 2 + (point.y - ay - t * dy) ** 2;
			if (squared <= distance) {
				distance = squared;
				nearest = region.component;
			}
		}
		if (inside) return region.component;
	}
	return nearest;
}

/** Reuse compiled triangles instead of rebuilding a trace while the pointer moves. */
export function planarRegionPositions(
	geometry: PlanarGeometry,
	component: number,
): Float32Array {
	const regions = geometry.regions.filter(
		(region) => region.component === component,
	);
	if (regions.length === 1) {
		const { start, count } = regions[0];
		return geometry.positions.subarray(start * 3, (start + count) * 3);
	}
	const positions = new Float32Array(
		regions.reduce((count, region) => count + region.count * 3, 0),
	);
	let offset = 0;
	for (const region of regions) {
		positions.set(
			geometry.positions.subarray(
				region.start * 3,
				(region.start + region.count) * 3,
			),
			offset,
		);
		offset += region.count * 3;
	}
	return positions;
}
