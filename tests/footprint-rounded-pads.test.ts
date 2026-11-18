import assert from "node:assert/strict";
import { test } from "node:test";
import {
	copperItems,
	itemDistance,
} from "@ecad/drawing-core/board/connectivity.ts";
import { createBoardFootprint } from "@ecad/drawing-core/board/footprints.ts";
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
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	createPad,
	createVia,
	editPad,
	isPad,
	type PadShape,
	padCornerRadius,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { fillZones, layerFill } from "#/board/fill.ts";
import { exportFabrication } from "#/board/gerber.ts";
import { maskOpenings } from "#/board/mask.ts";
import { containsPoint, GeometryCompiler } from "#/engine/geometry.ts";
import type { MultiPolygon } from "#/engine/types.ts";
import {
	createEmptyFootprintFile,
	footprintFileSchema,
	footprintFileWithShapes,
} from "#/footprint/format.ts";
import { parseGerber } from "#/formats/gerber/index.ts";
import { required } from "./helpers/required.ts";

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

test("copper distances, which connectivity and DRC use, and zone fills measure from the rounded corner", () => {
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

function gerberCoverage(
	files: readonly { name: string; content: string }[],
	suffix: string,
): MultiPolygon {
	const file = required(files.find(({ name }) => name.endsWith(suffix)));
	const { object, diagnostics } = parseGerber(file.content, file.name);
	assert.deepEqual(diagnostics, []);
	return object.objects.flatMap((item) => {
		const [a, b, c, d, e, f] = item.transform ?? [1, 0, 0, 1, 0, 0];
		return compiled(item.geometry).map((polygon) =>
			polygon.map((ring) =>
				ring.map(([x, y]): [number, number] => [
					a * x + c * y + e,
					b * x + d * y + f,
				]),
			),
		);
	});
}

test("Gerber copper, paste and mask draw the rounded outline", () => {
	const turned = { ...roundedPad(), id: 2, x: 5, rotation: Math.PI / 2 };
	const files = exportFabrication("pad", [roundedPad(), turned], [], 0.05);
	const layer = (suffix: string) => gerberCoverage(files, suffix);
	for (const suffix of ["F_Cu.gtl", "F_Paste.gtp"]) {
		const copper = layer(suffix);
		assert.equal(containsPoint(copper, insideCorner), true, suffix);
		assert.equal(containsPoint(copper, squareCorner), false, suffix);
		assert.equal(containsPoint(copper, { x: 0.99, y: 0 }), true, suffix);
		assert.equal(containsPoint(copper, { x: 5.3, y: 0.9 }), true, suffix);
		assert.equal(containsPoint(copper, { x: 5.48, y: 0.98 }), false, suffix);
	}
	const mask = layer("F_Mask.gts");
	assert.equal(containsPoint(mask, { x: 1.04, y: 0 }), true);
	assert.equal(containsPoint(mask, { x: 1.03, y: 0.53 }), false);
	const ends = exportFabrication(
		"ends",
		[
			roundedPad(0.5),
			{ ...roundedPad(0.5), id: 2, x: 5, width: 1 },
			{ ...roundedPad(0.5), id: 3, x: 10, rotation: Math.PI / 4 },
		],
		[],
		0.05,
	);
	for (const suffix of ["F_Cu.gtl", "F_Paste.gtp", "F_Mask.gts"]) {
		const drawn = gerberCoverage(ends, suffix);
		const grown = suffix === "F_Mask.gts" ? 0.05 : 0;
		for (const [point, inside] of [
			[{ x: 0.99 + grown, y: 0 }, true],
			[{ x: 0.95, y: 0.45 }, false],
			[{ x: 5, y: 0.49 + grown }, true],
			[{ x: 5.4, y: 0.4 }, false],
			[{ x: 10.672, y: 0.672 }, true],
			[{ x: 10.354, y: 0.99 }, false],
		] as const)
			assert.equal(
				containsPoint(drawn, point),
				inside,
				`${suffix} ${point.x},${point.y}`,
			);
	}
	const openings = [maskOpenings([roundedPad()]).top];
	assert.equal(containsPoint(openings, { x: 1.04, y: 0 }), true);
	assert.equal(containsPoint(openings, { x: 1.03, y: 0.53 }), false);
});

test("a footprint file keeps the corner ratio, and a flipped footprint keeps its rounded copper", () => {
	const file = footprintFileWithShapes(
		createEmptyFootprintFile("Rounded", []),
		[roundedPad()],
	);
	const loaded = footprintFileSchema.parse(JSON.parse(JSON.stringify(file)));
	const [saved] = loaded.shapes;
	assert.ok(isPad(saved) && saved.pad.cornerRatio === 0.25);

	const flipped = createBoardFootprint(
		30,
		{
			reference: { library: "project", id: loaded.id },
			name: loaded.name,
			shapes: loaded.shapes,
		},
		{ reference: "U1", value: "" },
		{ x: 10, y: 0 },
		{ flipped: true },
	);
	const pad = required(symbolShapes(flipped).find(isPad));
	assert.equal(pad.layer, "B.Cu");
	const [hull] = shapeHulls(pad);
	assert.ok(
		pointHullDistance(hull, { x: 10 - insideCorner.x, y: insideCorner.y }) < 0,
	);
	assert.ok(
		pointHullDistance(hull, { x: 10 - squareCorner.x, y: squareCorner.y }) > 0,
	);
	const back = gerberCoverage(
		exportFabrication("back", [flipped], [], 0.05),
		"B_Cu.gbl",
	);
	assert.equal(
		containsPoint(back, { x: 10 - insideCorner.x, y: insideCorner.y }),
		true,
	);
	assert.equal(
		containsPoint(back, { x: 10 - squareCorner.x, y: squareCorner.y }),
		false,
	);
});
