import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BufferGeometry,
	CircleGeometry,
	Float32BufferAttribute,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	Raycaster,
	Vector3,
} from "three";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import { symbolShapes } from "#/drawing/shapes.ts";
import {
	persistDrawingShapes,
	resolveDrawingSymbols,
} from "#/drawing/symbol-persistence.ts";
import { symbolReferenceKey } from "#/drawing/symbol-reference.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import {
	createShapeGeometry,
	mergeShapeGeometries,
} from "#/engine/drawing/shapeGeometry.ts";
import { required } from "./helpers/required.ts";

const resistor = required(
	symbolDefinitions.find(({ id }) => id === "resistor"),
);
const definitions = new Map([
	[symbolReferenceKey(required(resistor.library), resistor.id), resistor],
]);

const positions = (geometry: BufferGeometry) => [
	...(geometry.getAttribute("position")?.array ?? []),
];

for (const [name, override] of [
	["zero-width", { width: 0 }],
	["zero-stroke", { lineWidth: 0 }],
	["zero-stroke dashed", { lineWidth: 0, lineStyle: "dashed" }],
] as const) {
	test(`a ${name} symbol child does not blank the rest of the symbol`, (t) => {
		const errors = t.mock.method(console, "error", () => {});
		const [saved] = persistDrawingShapes([
			createSymbol(1, resistor, { x: 0, y: 0 }),
		]);
		const childOverrides = { "shape:1": override };
		// Files cannot hold a zero size; the renderer still tolerates one.
		assert.equal(
			drawingShapeSchema.safeParse({ ...saved, childOverrides }).success,
			false,
		);
		// Resolution drops overrides that do not fit, so add it afterwards.
		const resolved = resolveDrawingSymbols(
			[drawingShapeSchema.parse(saved)],
			[resistor],
			definitions,
		).shapes[0];
		const symbol = { ...resolved, childOverrides } as typeof resolved;
		assert.equal(symbol.kind, "symbol");
		if (symbol.kind !== "symbol") return;
		const lead = required(symbolShapes(symbol).find((child) => child.id === 1));
		assert.ok(lead.width === 0 || lead.lineWidth === 0);
		const display = buildDrawingDisplay([symbol], new Set()).shapes[0];
		assert.equal(display.geometry.kind, "symbol");
		if (display.geometry.kind !== "symbol") return;
		const degenerate = display.geometry.children.filter(
			(child) => child.width === 0 || child.lineWidth === 0,
		);
		assert.equal(degenerate.length, 1);
		const geometry = createShapeGeometry(display.geometry);
		const siblings = createShapeGeometry({
			...display.geometry,
			children: display.geometry.children.filter(
				(child) => !degenerate.includes(child),
			),
		});
		const material = new MeshBasicMaterial();
		const mesh = new Mesh(geometry, material);
		mesh.scale.set(symbol.width, symbol.height, 1);
		mesh.updateMatrixWorld();
		try {
			assert.ok(positions(geometry).length > 0);
			assert.deepEqual(positions(geometry), positions(siblings));
			for (const child of symbolShapes(symbol).filter(
				(child) => child.kind !== "pin" && child.id !== 1,
			)) {
				const offset = child.kind === "rectangle" ? child.height / 2 - 0.01 : 0;
				const hits = new Raycaster(
					new Vector3(child.x, child.y - offset, 10),
					new Vector3(0, 0, -1),
				).intersectObject(mesh);
				assert.ok(hits.length > 0, `child ${child.id} should still render`);
			}
			assert.equal(errors.mock.callCount(), 0);
		} finally {
			geometry.dispose();
			siblings.dispose();
			material.dispose();
		}
	});
}

test("a pin with a zero-stroke lead still renders its connection dot", (t) => {
	const errors = t.mock.method(console, "error", () => {});
	const geometry = createShapeGeometry({
		kind: "pin",
		width: 0.6,
		height: 0.6,
		lineWidth: 0,
		length: 2.54,
	});
	const dot = new CircleGeometry(0.3, 32);
	try {
		assert.deepEqual(positions(geometry), positions(dot));
		assert.equal(errors.mock.callCount(), 0);
	} finally {
		geometry.dispose();
		dot.dispose();
	}
});

test("a symbol whose children are all degenerate renders nothing without failing", (t) => {
	const errors = t.mock.method(console, "error", () => {});
	const geometry = createShapeGeometry({
		kind: "symbol",
		width: 4,
		height: 4,
		lineWidth: 0.2,
		children: [
			{
				kind: "line",
				x: 0,
				y: 0,
				width: 0,
				height: 1,
				rotation: 0,
				lineWidth: 0.2,
			},
			{
				kind: "wire",
				x: 0,
				y: 1,
				width: 2,
				height: 1,
				rotation: 0,
				lineWidth: 0,
			},
		],
	});
	try {
		assert.equal(geometry.getAttribute("position"), undefined);
		assert.equal(errors.mock.callCount(), 0);
	} finally {
		geometry.dispose();
	}
});

test("parts with incompatible layouts merge as plain triangles instead of vanishing", (t) => {
	t.mock.method(console, "error", () => {});
	const plane = new PlaneGeometry(1, 1);
	const triangle = new BufferGeometry();
	triangle.setAttribute(
		"position",
		new Float32BufferAttribute([2, 0, 0, 3, 0, 0, 2, 1, 0], 3),
	);
	const merged = mergeShapeGeometries(
		[plane, new BufferGeometry(), triangle],
		"symbol",
	);
	try {
		const position = merged.getAttribute("position");
		const index = required(merged.getIndex());
		assert.equal(index.count, required(plane.getIndex()).count + 3);
		assert.equal(merged.getAttribute("uv").count, position.count);
		assert.equal(merged.getAttribute("normal").count, position.count);
		const corners = Array.from({ length: index.count }, (_, item) =>
			[position.getX(index.getX(item)), position.getY(index.getX(item))].join(),
		);
		for (const corner of ["-0.5,0.5", "0.5,-0.5", "2,0", "3,0", "2,1"])
			assert.ok(corners.includes(corner), `${corner} should be merged`);
	} finally {
		plane.dispose();
		triangle.dispose();
		merged.dispose();
	}
});
