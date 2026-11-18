import assert from "node:assert/strict";
import test from "node:test";
import {
	screenToWorld,
	transformPoint,
	worldToScreen,
} from "#/engine/camera.ts";
import {
	containsPoint,
	flattenPath,
	GeometryCompiler,
} from "#/engine/geometry.ts";
import type { Geometry, Matrix } from "#/engine/types.ts";

const approximately = (actual: number, expected: number, epsilon = 1e-5) =>
	assert.ok(
		Math.abs(actual - expected) < epsilon,
		`${actual} differs from ${expected}`,
	);
const meshArea = (vertices: Float32Array) => {
	let sum = 0;
	for (let i = 0; i < vertices.length; i += 6)
		sum +=
			Math.abs(
				(vertices[i + 2] - vertices[i]) * (vertices[i + 5] - vertices[i + 1]) -
					(vertices[i + 4] - vertices[i]) * (vertices[i + 3] - vertices[i + 1]),
			) / 2;
	return sum;
};

test("camera coordinates round trip in Cartesian and mirrored views", () => {
	const camera = { x: 13.2, y: -5.6, scale: 24 };
	for (const mirrored of [false, true]) {
		const screen = worldToScreen({ x: 3, y: 4 }, camera, 800, 600, mirrored);
		const world = screenToWorld(screen, camera, 800, 600, mirrored);
		approximately(world.x, 3);
		approximately(world.y, 4);
	}
	assert.ok(
		worldToScreen({ x: 0, y: 1 }, { x: 0, y: 0, scale: 1 }, 100, 100).y < 50,
	);
});

test("affine transforms apply rotation, reflection, scale, and translation", () => {
	const matrix: Matrix = [0, -2, -2, 0, 3, 7];
	assert.deepEqual(transformPoint({ x: 4, y: 8 }, matrix), { x: -13, y: -1 });
	assert.deepEqual(transformPoint({ x: 4, y: 8 }), { x: 4, y: 8 });
});

test("odd winding resolves holes with identical winding and self-intersections", () => {
	const compiler = new GeometryCompiler();
	const ring = compiler.compile({
		type: "path",
		d: "M0 0 L10 0 L10 10 L0 10 Z M2 2 L8 2 L8 8 L2 8 Z",
		fill: true,
	});
	approximately(meshArea(ring.vertices), 64);
	assert.equal(containsPoint(ring.polygons, { x: 5, y: 5 }), false);
	const bowtie = compiler.compile({
		type: "path",
		d: "M0 0 L10 10 L0 10 L10 0 Z",
		fill: true,
	});
	approximately(meshArea(bowtie.vertices), 50);
	const twice = compiler.compile({
		type: "path",
		d: "M0 0 L10 0 L10 10 L0 10 L0 0 L10 0 L10 10 L0 10 Z",
		fill: true,
	});
	approximately(meshArea(twice.vertices), 0);
});

test("round path strokes preserve cap coverage", () => {
	const compiler = new GeometryCompiler();
	const trace: Geometry = {
		type: "path",
		d: "M0 0 L10 0",
		fill: false,
		strokeWidth: 2,
	};
	const mesh = compiler.compile(trace);
	approximately(meshArea(mesh.vertices), 20 + Math.PI, 0.03);
	assert.equal(containsPoint(mesh.polygons, { x: -0.9, y: 0 }), true);
	assert.equal(containsPoint(mesh.polygons, { x: 0, y: 2 }), false);
});

test("arc and cubic flattening preserve endpoints and adapt to tolerance", () => {
	const path = "M1 0 A1 1 0 0 1 0 1 C0 2 2 2 2 1 S4 0 4 1 Q5 2 6 1 T8 1";
	const coarse = flattenPath(path, 0.1)[0].points;
	const fine = flattenPath(path, 0.001)[0].points;
	assert.deepEqual(fine[0], [1, 0]);
	assert.deepEqual(fine.at(-1), [8, 1]);
	assert.ok(fine.length > coarse.length);
	const arc = flattenPath("M1 0 A1 1 0 0 1 0 1", 0.001)[0].points;
	for (const point of arc) approximately(Math.hypot(...point), 1);
});
