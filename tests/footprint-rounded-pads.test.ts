import assert from "node:assert/strict";
import { test } from "node:test";
import {
	copperItems,
	itemDistance,
} from "@ecad/drawing-core/board/connectivity.ts";
import {
	pointHullDistance,
	shapeHulls,
	trackSegment,
} from "@ecad/drawing-core/board/geometry.ts";
import { boardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import { defaultBoardRules } from "@ecad/drawing-core/board/rules.ts";
import { editorShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	type EditorShape,
	editShapeAttribute,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	createPad,
	createVia,
	editPad,
	type PadShape,
	padCornerRadius,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { fillZones, layerFill } from "#/board/fill.ts";
import { exportFabrication, maskOpenings } from "#/board/gerber.ts";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import { createShapeGeometry } from "#/engine/drawing/shapeGeometry.ts";
import { containsPoint, GeometryCompiler } from "#/engine/geometry.ts";
import type { MultiPolygon } from "#/engine/types.ts";
import { planFootprintBoard } from "#/footprint/board.ts";
import { parseGerber } from "#/formats/gerber/index.ts";
import { required } from "./helpers/required.ts";

const measure = (text: string) => text.length * 57.6;

/** A 2 by 1 mm pad at the origin with 0.25 mm corners. */
const roundedPad = (cornerRatio = 0.25): PadShape => {
	const pad = createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu");
	return {
		...pad,
		width: 2,
		height: 1,
		pad: { ...pad.pad, cornerRatio },
	};
};
const squareCorner = { x: 0.98, y: 0.48 };
const insideCorner = { x: 0.9, y: 0.3 };

const compiled = (geometry: Parameters<GeometryCompiler["compile"]>[0]) =>
	new GeometryCompiler().compile(geometry, 0.0005).polygons;

test("a rectangular pad takes a corner ratio up to one half, and a circle takes none", () => {
	const pad = roundedPad();
	assert.equal(editorShapeSchema.safeParse(pad).success, true);
	assert.equal(
		editorShapeSchema.safeParse(roundedPad(0.5)).success,
		true,
		"fully round ends",
	);
	for (const invalid of [
		roundedPad(0.6),
		roundedPad(0),
		{ ...pad, kind: "circle", width: 1, height: 1 },
		{
			...createPad(2, { x: 0, y: 0 }, "through-hole", "2", "F.Cu"),
			pad: { number: "2", type: "through-hole", drill: 1, cornerRatio: 0.25 },
		},
	])
		assert.equal(editorShapeSchema.safeParse(invalid).success, false);
});

test("the corner radius edit stores a share of the shorter side and resizing keeps it", () => {
	const square = createPad(1, { x: 0, y: 0 }, "smd", "1", "F.Cu");
	const rounded = editPad(square, { attribute: "cornerRadius", value: 0.25 });
	assert.equal(rounded.pad.cornerRatio, 0.25);
	assert.equal(padCornerRadius(rounded), 0.25);
	assert.equal(editorShapeSchema.safeParse(rounded).success, true);
	assert.deepEqual(
		editPad(rounded, { attribute: "cornerRadius", value: 0 }),
		square,
	);
	assert.equal(
		editPad(square, { attribute: "cornerRadius", value: 5 }).pad.cornerRatio,
		0.5,
	);
	assert.equal(
		editPad(square, { attribute: "cornerRadius", value: -1 }),
		square,
	);
	const wider = editShapeAttribute(rounded, "width", 2) as PadShape;
	assert.equal(wider.pad.cornerRatio, 0.25);
	assert.equal(padCornerRadius(wider), 0.375);
	const circle = editPad(rounded, { attribute: "shape", value: "circle" });
	assert.equal(circle.pad.cornerRatio, undefined);
	assert.equal(editorShapeSchema.safeParse(circle).success, true);
	assert.equal(
		editPad(circle, { attribute: "cornerRadius", value: 0.2 }),
		circle,
	);
});

test("rounded corners take copper off the pad's outline, down to a stadium or a disc", () => {
	const [hull] = shapeHulls(roundedPad());
	assert.equal(hull.radius, 0.25);
	assert.ok(pointHullDistance(hull, squareCorner) > 0);
	assert.ok(pointHullDistance(hull, insideCorner) < 0);
	assert.ok(Math.abs(pointHullDistance(hull, { x: 1, y: 0 })) < 1e-9);
	assert.equal(
		shapeHulls({ ...roundedPad(), pad: { number: "1", type: "smd" } })[0]
			.radius,
		0,
	);
	const stadium = shapeHulls(roundedPad(0.5));
	assert.deepEqual(stadium[0].points, [
		{ x: -0.5, y: 0 },
		{ x: 0.5, y: 0 },
	]);
	const disc = shapeHulls({ ...roundedPad(0.5), width: 1 });
	assert.deepEqual([disc[0].points, disc[0].radius], [[{ x: 0, y: 0 }], 0.5]);
	const turned = shapeHulls({ ...roundedPad(), rotation: Math.PI / 2 })[0];
	assert.ok(pointHullDistance(turned, { x: 0.48, y: 0.98 }) > 0);
});

test("connectivity, DRC and zone fills measure from the rounded corner", () => {
	const track = trackSegment(
		7,
		{ x: 1.15, y: 0.65 },
		{ x: 3, y: 2.5 },
		"F.Cu",
		0.1,
		"gnd",
	);
	const distance = (pad: PadShape) => {
		const [first, second] = copperItems([pad, track], boardNetlist(undefined));
		return itemDistance(first, second);
	};
	const square = {
		...roundedPad(),
		pad: { number: "1", type: "smd" as const },
	};
	assert.ok(distance(square) < defaultBoardRules.clearance);
	assert.ok(distance(roundedPad(0.5)) > defaultBoardRules.clearance);

	const outline: EditorShape = {
		id: 20,
		kind: "rectangle",
		layer: "Edge.Cuts",
		x: 0,
		y: 0,
		width: 12,
		height: 12,
		rotation: 0,
		lineWidth: 0.1,
	};
	const zone = {
		...outline,
		id: 21,
		layer: "F.Cu",
		width: 10,
		height: 10,
		zone: {},
		net: "gnd",
	} as EditorShape;
	const via = { ...createVia(22, { x: -4, y: -4 }), net: "gnd" };
	const fill = (pad: PadShape) =>
		layerFill(
			fillZones(
				[outline, zone, via, pad],
				boardNetlist(undefined),
				defaultBoardRules,
			),
			"F.Cu",
		);
	const pastCorner = { x: 1.12, y: 0.62 };
	assert.equal(containsPoint(fill(square), pastCorner), false);
	assert.equal(containsPoint(fill(roundedPad(0.5)), pastCorner), true);
});

test("Gerber copper, paste and mask draw the rounded outline", () => {
	const files = exportFabrication("pad", [roundedPad()], []);
	const layer = (suffix: string) => {
		const file = required(files.find(({ name }) => name.endsWith(suffix)));
		const { object, diagnostics } = parseGerber(file.content, file.name);
		assert.deepEqual(diagnostics, []);
		return object.objects.flatMap(
			(item) => compiled(item.geometry) as MultiPolygon,
		);
	};
	for (const suffix of ["F_Cu.gtl", "F_Paste.gtp"]) {
		const copper = layer(suffix);
		assert.equal(containsPoint(copper, insideCorner), true, suffix);
		assert.equal(containsPoint(copper, squareCorner), false, suffix);
		assert.equal(containsPoint(copper, { x: 0.99, y: 0 }), true, suffix);
	}
	const mask = layer("F_Mask.gts");
	assert.equal(containsPoint(mask, { x: 1.04, y: 0 }), true);
	assert.equal(containsPoint(mask, { x: 1.03, y: 0.53 }), false);
	const openings = [maskOpenings([roundedPad()]).top];
	assert.equal(containsPoint(openings, { x: 1.04, y: 0 }), true);
	assert.equal(containsPoint(openings, { x: 1.03, y: 0.53 }), false);
});

test("the flat view and the board view draw the corners", () => {
	const pad = roundedPad();
	const [display] = buildDrawingDisplay([pad], new Set(), [], measure).shapes;
	assert.equal(display.geometry.cornerRadius, 0.25);
	const mesh = createShapeGeometry(display.geometry).scale(2, 1, 1);
	const positions = mesh.getAttribute("position");
	let farthest = 0;
	for (let index = 0; index < positions.count; index++)
		farthest = Math.max(
			farthest,
			Math.hypot(positions.getX(index), positions.getY(index)),
		);
	const roundedCornerReach = Math.hypot(0.75, 0.25) + 0.25;
	assert.ok(farthest <= roundedCornerReach + 1e-6);
	assert.ok(farthest < Math.hypot(1, 0.5) - 0.05);

	const copper = required(
		planFootprintBoard([pad])
			.map((plan) => plan.build())
			.find((layer) => layer.id === "footprint:F.Cu"),
	);
	const [object] = copper.objects;
	assert.equal(object.geometry.type, "path");
	const outline = compiled(object.geometry);
	assert.equal(containsPoint(outline, insideCorner), true);
	assert.equal(containsPoint(outline, squareCorner), false);
});
