import assert from "node:assert/strict";
import { test } from "node:test";
import {
	placeShapesEffect,
	redoEffect,
	replaceShapesEffect,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { lineStyles } from "@ecad/drawing-core/drawing/line-style.ts";
import { drawingShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	type BasicShape,
	drawShape,
	isBasicShape,
	moveShapes,
	resizeHandles,
	resizeShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { Effect } from "effect";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import {
	symbolFileShapes,
	symbolFileWithShapes,
} from "#/drawing/symbol-file.ts";
import { createSymbolFromShapes } from "#/drawing/symbols.ts";
import { createShapeGeometry } from "#/engine/drawing/shapeGeometry.ts";
import { validateProjectDocument } from "#/projects/format.ts";

for (const kind of ["rectangle", "circle", "triangle", "line"] as const) {
	for (const lineStyle of lineStyles) {
		test(`${kind} renders ${lineStyle} strokes with gaps and a fixed stroke width`, () => {
			const shape: BasicShape = {
				...drawShape(1, kind, { x: 0, y: 0 }, { x: 80, y: 40 }),
				kind,
				lineWidth: 1,
				lineStyle,
			};
			const display = buildDrawingDisplay([shape], new Set()).shapes[0];
			const geometry = createShapeGeometry(display.geometry);
			const material = new MeshBasicMaterial();
			const mesh = new Mesh(geometry, material);
			mesh.scale.set(display.width, display.height, 1);
			mesh.updateMatrixWorld();
			const hits = (distance: number, offset = 0) => {
				const point =
					kind === "circle"
						? new Vector3(
								Math.cos(distance / (shape.width / 2)) *
									(shape.width / 2 + offset),
								Math.sin(distance / (shape.width / 2)) *
									(shape.width / 2 + offset),
								10,
							)
						: new Vector3(
								-shape.width / 2 + distance,
								(kind === "line" ? 0 : -shape.height / 2) + offset,
								10,
							);
				return (
					new Raycaster(point, new Vector3(0, 0, -1)).intersectObject(mesh)
						.length > 0
				);
			};
			try {
				assert.equal(hits(lineStyle === "dotted" ? 0 : 2), true);
				assert.equal(
					hits(lineStyle === "dotted" ? 1.5 : 7.5),
					lineStyle === "solid",
				);
				assert.equal(hits(lineStyle === "dotted" ? 0 : 2, 0.35), true);
				assert.equal(hits(lineStyle === "dotted" ? 0 : 2, 0.7), false);
				if (lineStyle === "dash-dot" || lineStyle === "dash-dot-dot") {
					assert.equal(hits(9), true);
					assert.equal(hits(10.5), false);
					assert.equal(hits(12), true);
					assert.equal(hits(13.5), lineStyle === "dash-dot");
				}
				assert.ok(
					[...geometry.getAttribute("position").array].every(Number.isFinite),
				);
			} finally {
				geometry.dispose();
				material.dispose();
			}
		});
	}
}

test("line styles survive document validation, symbol files, movement, and resizing", () => {
	const shapes = lineStyles.map(
		(lineStyle, index): BasicShape => ({
			...drawShape(
				index + 1,
				index % 2 ? "line" : "rectangle",
				{ x: index * 100, y: 0 },
				{ x: index * 100 + 80, y: 40 },
			),
			kind: index % 2 ? "line" : "rectangle",
			lineStyle,
		}),
	);
	assert.deepEqual(
		validateProjectDocument({ shapes, symbols: [] }).shapes,
		shapes,
	);
	const file = parseSymbolFile(
		JSON.stringify(
			symbolFileWithShapes(
				{
					format: "ecad-symbol",
					version: 1,
					units: "mm",
					id: "line-styles",
					name: "Line styles",
					description: "",
					prefix: "U",
					value: "",
					shapes: [],
				},
				shapes,
			),
		),
	);
	assert.deepEqual(
		symbolFileShapes(file)
			.filter(isBasicShape)
			.map((shape) => shape.lineStyle),
		lineStyles,
	);
	for (const shape of shapes) {
		assert.equal(drawingShapeSchema.safeParse(shape).success, true);
		assert.equal(
			drawingShapeSchema.safeParse({ ...shape, lineStyle: "invalid" }).success,
			false,
		);
		assert.equal(
			(moveShapes([shape], { x: 4, y: 7 })[0] as BasicShape).lineStyle,
			shape.lineStyle,
		);
		for (const handle of resizeHandles(shape))
			assert.equal(
				(resizeShape(shape, handle, { x: 2, y: 3 }) as BasicShape).lineStyle,
				shape.lineStyle,
			);
	}
	const symbol = createSymbolFromShapes(20, shapes);
	const geometry = createShapeGeometry(
		buildDrawingDisplay([symbol], new Set()).shapes[0].geometry,
	);
	try {
		assert.ok(geometry.getAttribute("position").count > 0);
		assert.ok(
			[...geometry.getAttribute("position").array].every(Number.isFinite),
		);
	} finally {
		geometry.dispose();
	}
});

test("legacy drawings stay solid and extreme stroke ratios produce bounded geometry", () => {
	const legacy = drawShape(1, "line", { x: 0, y: 0 }, { x: 1000, y: 0 });
	assert.deepEqual(drawingShapeSchema.parse(legacy), legacy);
	const geometry = createShapeGeometry({
		...legacy,
		lineWidth: 0.00001,
		lineStyle: "dotted",
	});
	try {
		assert.ok(geometry.getAttribute("position").count <= 2049 * 48);
	} finally {
		geometry.dispose();
	}
});

test("changing only a line style commits a reversible edit and solid remains the default", () => {
	const store = createDrawingStore();
	const run = <A, E>(effect: Effect.Effect<A, E, DrawingStore>) =>
		Effect.runSync(effect.pipe(Effect.provideService(DrawingStore, store)));
	const shape: BasicShape = {
		...drawShape(1, "rectangle", { x: 0, y: 0 }, { x: 80, y: 40 }),
		kind: "rectangle",
	};
	run(placeShapesEffect([shape], "Place rectangle"));
	const original = store.getSnapshot();
	run(replaceShapesEffect([{ ...shape, lineStyle: "solid" }], "Solid default"));
	assert.equal(
		store.getSnapshot().history.currentId,
		original.history.currentId,
	);
	run(
		replaceShapesEffect(
			[{ ...shape, lineStyle: "dashed" }],
			"Change line style",
		),
	);
	assert.equal(
		(store.getSnapshot().shapes[0] as BasicShape).lineStyle,
		"dashed",
	);
	run(undoEffect);
	assert.deepEqual(store.getSnapshot().shapes, original.shapes);
	run(redoEffect);
	assert.equal(
		(store.getSnapshot().shapes[0] as BasicShape).lineStyle,
		"dashed",
	);
});
