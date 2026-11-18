import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { generateDefaultFootprints } from "@ecad/default-footprints";
import {
	type BoardFootprint,
	createBoardFootprint,
} from "@ecad/drawing-core/board/footprints.ts";
import {
	type EditorShape,
	symbolTextShapes,
	type TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { textCenter } from "@ecad/drawing-core/drawing/text-alignment.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import { exportFabrication } from "#/board/gerber.ts";
import {
	lineHeight,
	overbarRise,
	overbarThickness,
	updateText,
} from "#/drawing/text.ts";
import { containsPoint } from "#/engine/geometry.ts";
import { parseGerber } from "#/formats/gerber/index.ts";
import {
	glyphOutlines,
	glyphOutlinesFile,
} from "../scripts/fonts/glyph-outlines.ts";
import { required } from "./helpers/required.ts";

type Ring = [number, number][];

const measure = (text: string) => [...text].length * 57.6;
const unit = (fontSize: number) => fontSize / 1000;

function text(
	value: string,
	fields: Partial<TextShape> & { layer?: FootprintLayer } = {},
): TextShape {
	return updateText(
		{
			id: 1,
			kind: "text",
			x: 10,
			y: 5,
			width: 1,
			height: 1,
			rotation: 0,
			lineWidth: 0.1,
			text: value,
			fontSize: 4,
			horizontalAlign: "center",
			verticalAlign: "middle",
			layer: "F.SilkS",
			...fields,
		},
		value,
		measure,
	);
}

const layerFile: Partial<Record<FootprintLayer, string>> = {
	"F.SilkS": "F_Silkscreen.gto",
	"B.SilkS": "B_Silkscreen.gbo",
	"F.Cu": "F_Cu.gtl",
	"F.Mask": "F_Mask.gts",
	"Edge.Cuts": "Edge_Cuts.gm1",
};

function gerber(shapes: readonly EditorShape[], layer: FootprintLayer) {
	const suffix = required(layerFile[layer]);
	return required(
		exportFabrication("text", shapes, [], 0.05).find((file) =>
			file.name.endsWith(suffix),
		),
	).content;
}

function regions(content: string): Ring[] {
	const rings: Ring[] = [];
	let ring: Ring | undefined;
	for (const line of content.split("\n")) {
		if (line === "G36*") ring = [];
		else if (line === "G37*" && ring) {
			rings.push(ring);
			ring = undefined;
		} else if (ring) {
			const match = /^X(-?\d+)Y(-?\d+)D0[12]\*$/.exec(line);
			if (match) ring.push([Number(match[1]) / 1e6, Number(match[2]) / 1e6]);
		}
	}
	return rings;
}

const inked = (rings: readonly Ring[]) => (point: Point) =>
	rings.some((ring) => containsPoint([[ring]], point));

function bounds(rings: readonly Ring[]) {
	const xs = rings.flat().map(([x]) => x);
	const ys = rings.flat().map(([, y]) => y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	return {
		minX,
		maxX,
		minY,
		maxY,
		width: maxX - minX,
		height: maxY - minY,
		center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
	};
}

const near = (actual: number, expected: number, tolerance = 0.005) =>
	assert.ok(
		Math.abs(actual - expected) <= tolerance,
		`expected ${actual} to be within ${tolerance} of ${expected}`,
	);

function grid(around: ReturnType<typeof bounds>, steps = 40): Point[] {
	const points: Point[] = [];
	for (let i = 0; i <= steps; i++)
		for (let j = 0; j <= steps; j++)
			points.push({
				x: around.minX - 0.1 + ((around.width + 0.2) * (i + 0.37)) / steps,
				y: around.minY - 0.1 + ((around.height + 0.2) * (j + 0.61)) / steps,
			});
	return points;
}

function reflect(point: Point, center: Point, rotation: number): Point {
	const ux = Math.cos(rotation);
	const uy = Math.sin(rotation);
	const along = (point.x - center.x) * ux + (point.y - center.y) * uy;
	return { x: point.x - 2 * along * ux, y: point.y - 2 * along * uy };
}

const library = new Map(
	generateDefaultFootprints().map(({ file }) => [file.id, file]),
);
const r0805 = { library: "builtin", id: "r_0805_2012metric" } as const;

function resistor(
	id: number,
	reference: string,
	at: Point,
	options: { flipped?: boolean; shapes?: EditorShape[] } = {},
): BoardFootprint {
	const file = required(library.get(r0805.id));
	return createBoardFootprint(
		id,
		{
			reference: r0805,
			name: file.name,
			shapes: [...file.shapes, ...(options.shapes ?? [])],
		},
		{ reference, value: "10k" },
		at,
		{ flipped: options.flipped },
	);
}

function labelBox(footprint: BoardFootprint) {
	const label = required(symbolTextShapes(footprint)[0]);
	const center = textCenter(label);
	return (ring: Ring) => {
		const box = bounds([ring]);
		return (
			Math.abs(box.center.x - center.x) < label.width / 2 &&
			Math.abs(box.center.y - center.y) < label.height / 2
		);
	};
}

describe("board text in Gerber files", () => {
	test("silkscreen text keeps the editor's position and size", () => {
		const shape = text("H");
		const ink = bounds(regions(gerber([shape], "F.SilkS")));
		near(ink.center.x, 10);
		near(ink.center.y, 5);
		near(ink.width, (507 - 93) * unit(4));
		near(ink.height, 730 * unit(4));
	});

	test("rotated text turns about its anchor and stays upright", () => {
		const quarter = bounds(
			regions(gerber([text("H", { rotation: Math.PI / 2 })], "F.SilkS")),
		);
		near(quarter.center.x, 10);
		near(quarter.center.y, 5);
		near(quarter.width, 730 * unit(4));
		near(quarter.height, (507 - 93) * unit(4));
		const upright = regions(gerber([text("L")], "F.SilkS"));
		const turned = regions(
			gerber([text("L", { rotation: Math.PI })], "F.SilkS"),
		);
		assert.deepEqual(turned, upright);
	});

	test("alignment moves the ink to the side of the anchor the editor shows", () => {
		const left = bounds(
			regions(gerber([text("H", { horizontalAlign: "left" })], "F.SilkS")),
		);
		const padding = (12 * 4) / 96;
		near(left.minX, 10 + padding + 93 * unit(4));
		const right = bounds(
			regions(gerber([text("H", { horizontalAlign: "right" })], "F.SilkS")),
		);
		near(right.maxX, 10 - padding - (600 - 507) * unit(4));
		const top = bounds(
			regions(gerber([text("H", { verticalAlign: "top" })], "F.SilkS")),
		);
		near(top.center.y, 5 - text("H").height / 2);
	});

	test("back silkscreen text is mirrored so it reads from below", () => {
		for (const rotation of [0, Math.PI / 3]) {
			const front = regions(gerber([text("L", { rotation })], "F.SilkS"));
			const back = regions(
				gerber([text("L", { rotation, layer: "B.SilkS" })], "B.SilkS"),
			);
			const center = { x: 10, y: 5 };
			const frontInk = inked(front);
			const backInk = inked(back);
			const points = grid(bounds(front));
			assert.ok(
				points.some(
					(point) =>
						frontInk(point) !== frontInk(reflect(point, center, rotation)),
				),
			);
			for (const point of points)
				assert.equal(
					backInk(reflect(point, center, rotation)),
					frontInk(point),
				);
		}
	});

	test("glyph holes stay open", () => {
		const content = gerber([text("O")], "F.SilkS");
		const rings = regions(content);
		assert.equal(rings.length, 1);
		const ink = inked(rings);
		const box = bounds(rings);
		near(box.width, (512 - 88) * unit(4));
		near(box.height, 750 * unit(4));
		assert.equal(ink(box.center), false);
		assert.equal(ink({ x: box.minX + 0.05, y: box.center.y }), true);
		assert.ok(parseGerber(content, "text.gto").object.objects.length > 0);
	});

	test("lines stack downward and overbars sit above their letters", () => {
		const scale = 4 / 96;
		const capital = 730 * unit(4);
		const stacked = bounds(regions(gerber([text("H\nH")], "F.SilkS")));
		near(stacked.height, lineHeight * scale + capital);
		near(stacked.center.y, 5);
		const barred = bounds(regions(gerber([text("~{H}")], "F.SilkS")));
		near(barred.height, (overbarRise + overbarThickness / 2) * scale);
		near(barred.width, 600 * unit(4));
	});

	test("thin strokes grow to the minimum silkscreen width", () => {
		for (const [bold, fontSize, crossbar, thinnest] of [
			[false, 1, 68, 46],
			[false, 3.2, 68, 46],
			[true, 1, 79, 62],
			[true, 2.4, 79, 62],
		] as const) {
			const rings = regions(
				gerber([text("e", { fontSize, ...(bold ? { bold } : {}) })], "F.SilkS"),
			);
			const ink = inked(rings);
			const box = bounds(rings);
			const runs: number[] = [];
			let run = 0;
			for (let y = box.minY - 0.01; y <= box.maxY + 0.01; y += 0.0005) {
				if (ink({ x: box.center.x, y })) run += 0.0005;
				else if (run) {
					runs.push(run);
					run = 0;
				}
			}
			assert.equal(runs.length, 3);
			near(
				Math.min(...runs),
				0.15 + (crossbar - thinnest) * unit(fontSize),
				0.004,
			);
		}
	});

	test("footprint reference labels reach the silkscreen of their side", () => {
		const front = resistor(1, "R7", { x: 20, y: 10 });
		const back = resistor(2, "R8", { x: 40, y: 10 }, { flipped: true });
		const top = regions(gerber([front, back], "F.SilkS"));
		const bottom = regions(gerber([front, back], "B.SilkS"));
		assert.equal(top.filter(labelBox(front)).length, 2);
		assert.equal(bottom.filter(labelBox(back)).length, 2);
		assert.equal(top.filter(labelBox(back)).length, 0);
		assert.equal(bottom.filter(labelBox(front)).length, 0);
	});

	test("footprint text resolves its variables and fabrication text stays out", () => {
		const shapes: EditorShape[] = [
			{ ...text(`\${REFERENCE}`, { x: 0, y: 2 }), id: 90 },
			{ ...text(`\${VALUE}`, { x: 0, y: -2, layer: "F.Fab" }), id: 91 },
		];
		const footprint = resistor(1, "R9", { x: 20, y: 10 }, { shapes });
		assert.deepEqual(footprint.texts, []);
		const rings = regions(gerber([footprint], "F.SilkS"));
		assert.equal(rings.length, 2);
		near(bounds(rings).center.y, 12, 0.3);
	});

	test("the glyph outlines match the bundled fonts", () => {
		assert.deepEqual(
			JSON.parse(readFileSync(glyphOutlinesFile, "utf8")),
			glyphOutlines(),
		);
	});
});
