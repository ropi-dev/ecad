import assert from "node:assert/strict";
import test from "node:test";
import {
	compilePlanarGeometry,
	simplifyPlanarEdges,
} from "#/engine/planar-geometry";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
} from "#/engine/planar-object";
import type { SceneObject } from "#/engine/types";
import { Box3, Mesh } from "three";

const rect = (
	size: number,
	polarity: "dark" | "clear" = "dark",
): SceneObject => ({
	id: String(size),
	geometry: { type: "rect", x: 0, y: 0, width: size, height: size },
	bounds: { minX: -size / 2, minY: -size / 2, maxX: size / 2, maxY: size / 2 },
	polarity,
	attributes: {},
});
const area = (vertices: Float32Array) => {
	let sum = 0;
	for (let i = 0; i < vertices.length; i += 9) {
		const ax = vertices[i + 3] - vertices[i],
			ay = vertices[i + 4] - vertices[i + 1];
		const bx = vertices[i + 6] - vertices[i],
			by = vertices[i + 7] - vertices[i + 1];
		sum += Math.abs(ax * by - ay * bx) / 2;
	}
	return sum;
};

test("planar meshes resolve dark unions, clear cutouts and later dark islands", () => {
	const compiled = compilePlanarGeometry([
		rect(8),
		rect(8),
		rect(4, "clear"),
		rect(2),
	]);
	assert.equal(area(compiled.positions), 52);
	assert.equal(compiled.edges.length, 12 * 6);
	assert.equal(
		compilePlanarGeometry([rect(8), rect(8, "clear")]).positions.length,
		0,
	);
});

test("planar meshes apply transforms before resolving exposures", () => {
	const compiled = compilePlanarGeometry([
		{ ...rect(4), transform: [-2, 0, 0, 1, 10, 20] },
		{ ...rect(2, "clear"), transform: [1, 0, 0, 1, 10, 20] },
	]);
	assert.equal(area(compiled.positions), 28);
	const xs = compiled.positions.filter((_, i) => i % 3 === 0);
	const ys = compiled.positions.filter((_, i) => i % 3 === 1);
	assert.equal(Math.min(...xs), 6);
	assert.equal(Math.max(...xs), 14);
	assert.equal(Math.min(...ys), 18);
	assert.equal(Math.max(...ys), 22);
});

test("planar objects are real mesh geometry without maps or backing images", () => {
	const object = createPlanarObject3D({
		type: "planar",
		id: "test",
		name: "test",
		color: "#ff0000",
		visible: true,
		opacity: 1,
		metadata: {},
		objects: [rect(8), rect(4, "clear")],
		bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 },
	});
	assert.deepEqual(new Box3().setFromObject(object).min.toArray(), [-4, -4, 0]);
	let meshes = 0;
	object.traverse((part) => {
		if (!(part instanceof Mesh)) return;
		meshes++;
		assert.ok(part.geometry.getAttribute("position").count > 3);
		for (const material of Array.isArray(part.material)
			? part.material
			: [part.material]) {
			assert.ok(!("map" in material) || !material.map);
		}
	});
	assert.equal(meshes, 3);
	disposePlanarObject3D(object);
});

test("outline simplification preserves closed contours within its distance tolerance", () => {
	const circle = (radius: number, polarity: "dark" | "clear"): SceneObject => ({
		...rect(radius * 2, polarity),
		geometry: { type: "circle", x: 0, y: 0, radius },
	});
	const { edges } = compilePlanarGeometry([
		circle(4, "dark"),
		circle(2, "clear"),
	]);
	const tolerance = 0.005;
	const simplified = simplifyPlanarEdges(edges, tolerance);
	assert.ok(simplified.length < edges.length / 4);
	for (let i = 0; i < edges.length; i += 6) {
		let distance = Infinity;
		for (let j = 0; j < simplified.length; j += 6) {
			const dx = simplified[j + 3] - simplified[j];
			const dy = simplified[j + 4] - simplified[j + 1];
			const x = edges[i] - simplified[j];
			const y = edges[i + 1] - simplified[j + 1];
			const t = Math.max(
				0,
				Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy)),
			);
			distance = Math.min(distance, Math.hypot(x - t * dx, y - t * dy));
		}
		assert.ok(distance <= tolerance + 0.000001);
	}
	let rings = 0;
	let start = 0;
	for (let i = 0; i < simplified.length; i += 6) {
		if (
			simplified[i + 3] === simplified[start] &&
			simplified[i + 4] === simplified[start + 1]
		) {
			rings++;
			start = i + 6;
		} else {
			assert.equal(simplified[i + 3], simplified[i + 6]);
			assert.equal(simplified[i + 4], simplified[i + 7]);
		}
	}
	assert.equal(rings, 2);
	const tiny = compilePlanarGeometry([circle(0.001, "dark")]).edges;
	assert.deepEqual(simplifyPlanarEdges(tiny, tolerance), tiny);
	const corners = compilePlanarGeometry([rect(4)]).edges;
	assert.deepEqual(simplifyPlanarEdges(corners, tolerance), corners);
});
