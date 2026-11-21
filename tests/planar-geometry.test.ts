import assert from "node:assert/strict";
import test from "node:test";
import { Mesh } from "three";
import {
	compilePlanarGeometry,
	simplifyPlanarEdges,
} from "#/engine/planar-geometry.ts";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
} from "#/engine/planar-object.ts";
import {
	buildGeometryWalls,
	buildPlanarWalls,
	instancedRegions,
} from "#/engine/planar-walls.ts";
import type { PlanarObject, SceneObject } from "#/engine/types.ts";
import { parseGerber } from "#/formats/gerber/index.ts";
import { pthGerber } from "./fixtures/pth-gerber";
import { required } from "./helpers/required.ts";

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

test("PTH aperture holes and alternating clear flashes produce the same coverage", () => {
	const meshes = [false, true].map((alternating) => {
		const result = parseGerber(pthGerber(200, alternating), "PTH.gbr");
		assert.deepEqual(result.diagnostics, []);
		return compilePlanarGeometry(result.object.objects);
	});
	assert.equal(meshes[0].positions.length, meshes[1].positions.length);
	assert.equal(meshes[0].edges.length, meshes[1].edges.length);
	assert.ok(
		Math.abs(area(meshes[0].positions) - area(meshes[1].positions)) < 0.001,
	);
	assert.ok(
		Math.abs(
			area(meshes[0].positions) - 200 * Math.PI * (0.75 ** 2 - 0.4 ** 2),
		) < 0.05,
	);
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

test("instanced planar geometry splits fills and walls while preserving full coverage and bounds", () => {
	const sharedPad = rect(2).geometry;
	const placed = (
		size: number,
		x: number,
		y: number,
		geometry = rect(size).geometry,
	): SceneObject => ({
		id: `${size}@${x},${y}`,
		geometry,
		polarity: "dark",
		attributes: {},
		transform: [1, 0, 0, 1, x, y],
		bounds: {
			minX: x - size / 2,
			minY: y - size / 2,
			maxX: x + size / 2,
			maxY: y + size / 2,
		},
	});
	const objects = [
		...Array.from({ length: 16 }, (_, index) =>
			placed(2, index * 10, (index % 4) * 10, sharedPad),
		),
		placed(5, 200, 0),
	];
	const compiled = compilePlanarGeometry(objects);
	const instances = required(compiled.instances);
	assert.equal(instances.length, 1);
	assert.equal(instances[0].offsets.length, 16 * 2);
	assert.equal(instances[0].regions.length, 16);
	assert.equal(
		instancedRegions(compiled.regions.length, instances).filter(Boolean).length,
		16,
	);

	const slabWalls = buildGeometryWalls(compiled, "slab");
	const source: PlanarObject = {
		type: "planar",
		id: "instanced-layer",
		name: "instanced-layer",
		objects,
		bounds: { minX: -1, minY: -2.5, maxX: 202.5, maxY: 31 },
		color: "#cc8844",
		visible: true,
		opacity: 1,
		metadata: {},
	};
	const object3d = createPlanarObject3D(source, compiled, slabWalls, {
		outlines: false,
	});
	try {
		const fill = object3d.children.find(
			(child): child is Mesh =>
				child instanceof Mesh && child.userData.planarPart === "fill",
		);
		const fillInstances = object3d.children.find(
			(child): child is Mesh =>
				child instanceof Mesh && child.userData.planarPart === "fill-instances",
		);
		const plainPositions = required(fill).geometry.getAttribute("position")
			.array as Float32Array;
		const protoPositions = required(fillInstances).geometry.getAttribute(
			"position",
		).array as Float32Array;
		const offsets = required(fillInstances).geometry.getAttribute(
			"instanceOffset",
		).array as Float32Array;

		const xyBounds = (vertices: Float32Array) => {
			let minX = Infinity,
				minY = Infinity,
				maxX = -Infinity,
				maxY = -Infinity;
			for (let index = 0; index < vertices.length; index += 3) {
				minX = Math.min(minX, vertices[index]);
				maxX = Math.max(maxX, vertices[index]);
				minY = Math.min(minY, vertices[index + 1]);
				maxY = Math.max(maxY, vertices[index + 1]);
			}
			return { minX, minY, maxX, maxY };
		};

		let totalArea = area(plainPositions);
		const splitBounds = xyBounds(plainPositions);
		const protoArea = area(protoPositions);
		const protoBounds = xyBounds(protoPositions);
		for (let index = 0; index < offsets.length; index += 2) {
			const ox = offsets[index],
				oy = offsets[index + 1];
			totalArea += protoArea;
			splitBounds.minX = Math.min(splitBounds.minX, protoBounds.minX + ox);
			splitBounds.maxX = Math.max(splitBounds.maxX, protoBounds.maxX + ox);
			splitBounds.minY = Math.min(splitBounds.minY, protoBounds.minY + oy);
			splitBounds.maxY = Math.max(splitBounds.maxY, protoBounds.maxY + oy);
		}
		assert.equal(totalArea, area(compiled.positions));
		assert.deepEqual(splitBounds, xyBounds(compiled.positions));
	} finally {
		disposePlanarObject3D(object3d);
	}

	for (const [extrude, wall] of [
		["slab", 0],
		["barrel", 0.1],
	] as const) {
		const split = buildGeometryWalls(compiled, extrude, wall);
		const full = buildPlanarWalls(compiled.edges, extrude, wall);
		const instancedVertexFloats = (split.instances ?? []).reduce(
			(sum, entry, index) =>
				sum + entry.positions.length * (instances[index].offsets.length / 2),
			0,
		);
		assert.equal(
			split.positions.length + instancedVertexFloats,
			full.positions.length,
		);
	}
});
