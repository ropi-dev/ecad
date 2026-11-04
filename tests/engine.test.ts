import assert from "node:assert/strict";
import test from "node:test";
import {
	getSceneBounds,
	screenToWorld,
	transformPoint,
	worldToScreen,
} from "#/engine/camera.ts";
import {
	containsPoint,
	flattenPath,
	GeometryCompiler,
} from "#/engine/geometry.ts";
import type {
	Geometry,
	Matrix,
	SceneLayer,
	SceneObject,
} from "#/engine/types.ts";

const rectangle: Geometry = { type: "rect", x: 0, y: 0, width: 10, height: 10 };
const hole: Geometry = { type: "circle", x: 0, y: 0, radius: 2 };
const bounds = { minX: -5, minY: -5, maxX: 5, maxY: 5 };
const object = (
	id: string,
	geometry: Geometry = rectangle,
	polarity: "dark" | "clear" = "dark",
): SceneObject => ({ id, geometry, polarity, bounds, attributes: {} });
const layer = (objects: SceneObject[], id = "layer"): SceneLayer => ({
	id,
	name: id,
	objects,
	bounds,
	visible: true,
	opacity: 1,
	color: "#ffffff",
	metadata: {},
});
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

test("scene bounds ignore hidden layers and default to a finite empty scene", () => {
	assert.deepEqual(getSceneBounds([]), {
		minX: -25,
		minY: -20,
		maxX: 25,
		maxY: 20,
	});
	assert.deepEqual(
		getSceneBounds([
			layer([object("a")]),
			{
				...layer([object("b")]),
				visible: false,
				bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
			},
		]),
		bounds,
	);
});

test("affine transforms apply rotation, reflection, scale, and translation", () => {
	const matrix: Matrix = [0, -2, -2, 0, 3, 7];
	assert.deepEqual(transformPoint({ x: 4, y: 8 }, matrix), { x: -13, y: -1 });
	assert.deepEqual(transformPoint({ x: 4, y: 8 }), { x: 4, y: 8 });
});

test("nested group holes remain isolated from earlier geometry", () => {
	const compiler = new GeometryCompiler();
	const ring: Geometry = {
		type: "group",
		children: [
			{ geometry: rectangle, polarity: "dark" },
			{ geometry: hole, polarity: "clear" },
		],
	};
	const compiled = compiler.compile(ring);
	assert.equal(containsPoint(compiled.polygons, { x: 0, y: 0 }), false);
	assert.equal(containsPoint(compiled.polygons, { x: 4, y: 0 }), true);
	approximately(meshArea(compiled.vertices), 100 - Math.PI * 4, 0.03);
	const nested: Geometry = {
		type: "group",
		children: [
			{ geometry: rectangle, polarity: "dark" },
			{ geometry: ring, polarity: "clear" },
		],
	};
	const nestedMesh = compiler.compile(nested);
	assert.equal(containsPoint(nestedMesh.polygons, { x: 0, y: 0 }), true);
	assert.equal(containsPoint(nestedMesh.polygons, { x: 4, y: 0 }), false);
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

test("batched curved strokes preserve circular holes and intersecting contours", () => {
	const compiler = new GeometryCompiler();
	const circle = "M4 0 A4 4 0 0 1 -4 0 A4 4 0 0 1 4 0 Z";
	const geometry: Geometry = {
		type: "path",
		d: circle,
		fill: false,
		strokeWidth: 1,
	};
	const ring = compiler.compile(geometry, 0.0001);
	approximately(meshArea(ring.vertices), 8 * Math.PI, 0.005);
	assert.equal(ring.polygons.length, 1);
	assert.equal(ring.polygons[0].length, 2);
	const crossing = compiler.compile(
		{
			...geometry,
			d: `${circle} M8 0 A4 4 0 0 1 0 0 A4 4 0 0 1 8 0 Z`,
		},
		0.0001,
	);
	for (let x = -5; x <= 9; x += 0.23) {
		for (let y = -5; y <= 5; y += 0.29) {
			const distance = Math.min(
				Math.abs(Math.hypot(x, y) - 4),
				Math.abs(Math.hypot(x - 4, y) - 4),
			);
			if (Math.abs(distance - 0.5) < 0.001) continue;
			assert.equal(containsPoint(crossing.polygons, { x, y }), distance < 0.5);
		}
	}
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

test("mesh cache retains finer geometry while zooming out and refines when zooming in", () => {
	const compiler = new GeometryCompiler();
	const coarse = compiler.compile(hole, 0.1);
	assert.equal(compiler.compile(hole, 0.2), coarse);
	const fine = compiler.compile(hole, 0.001);
	assert.notEqual(fine, coarse);
	assert.ok(fine.vertices.length > coarse.vertices.length);
	assert.equal(compiler.compile(hole, 0.1), fine);
});

test("rotated rounded pad unions tolerate coincident edges at submillimetre scale", () => {
	const compiler = new GeometryCompiler();
	for (const scale of [1, 0.01]) {
		const rotate = (x: number, y: number) => ({
			x: (x - y) * Math.SQRT1_2 * scale,
			y: (x + y) * Math.SQRT1_2 * scale,
		});
		const rect = (width: number, height: number): Geometry => ({
			type: "path",
			fill: true,
			d:
				[
					[-width / 2, height / 2],
					[width / 2, height / 2],
					[width / 2, -height / 2],
					[-width / 2, -height / 2],
				]
					.map(([x, y], index) => {
						const p = rotate(x, y);
						return `${index ? "L" : "M"}${p.x} ${p.y}`;
					})
					.join(" ") + " Z",
		});
		const shapes: Geometry[] = [rect(4, 2), rect(3, 3)];
		for (const x of [-1.5, 1.5])
			for (const y of [-1, 1])
				shapes.push({ type: "circle", ...rotate(x, y), radius: 0.5 * scale });
		const mesh = compiler.compile(
			{
				type: "group",
				children: shapes.map((geometry) => ({ geometry, polarity: "dark" })),
			},
			0.0002 * scale,
		);
		approximately(
			meshArea(mesh.vertices) / (scale * scale),
			12 - (4 - Math.PI) / 4,
			0.002,
		);
	}
});
