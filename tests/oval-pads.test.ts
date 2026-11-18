import assert from "node:assert/strict";
import { test } from "node:test";
import { hullDistance, shapeHulls } from "@ecad/drawing-core/board/geometry.ts";
import { editorShapeSchema } from "@ecad/drawing-core/drawing/schema.ts";
import {
	createPad,
	editPad,
	type PadShape,
	shapeHole,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { exportFabrication } from "#/board/gerber.ts";
import { buildStaticDisplay } from "#/drawing/display.ts";
import { planFootprintBoard } from "#/footprint/board.ts";
import { parseGerber } from "#/formats/gerber/index.ts";
import { required } from "./helpers/required.ts";

const close = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

function shieldPad(rotation = 0, x = 0, y = 0): PadShape {
	const pad = createPad(1, { x, y }, "through-hole", "S1", "F.Cu");
	const oval = editPad(
		{
			...editPad(pad, { attribute: "shape", value: "oval" }),
			width: 1.1,
			height: 1.8,
		},
		{ attribute: "drill", value: 0.7 },
	);
	const slotted = editPad(editPad(oval, { attribute: "hole", value: "slot" }), {
		attribute: "slot",
		value: 1.2,
	});
	return { ...slotted, rotation: slotted.rotation + rotation };
}

test("an oval pad is a rectangle pad with round ends, and a slot fits inside it", () => {
	const pad = shieldPad();
	assert.deepEqual(
		[
			pad.kind,
			pad.width,
			pad.height,
			pad.pad.cornerRatio,
			pad.pad.drill,
			pad.pad.slot,
		],
		["rectangle", 1.8, 1.1, 0.5, 0.7, 1.2],
	);
	close(pad.rotation, Math.PI / 2);
	assert.equal(editorShapeSchema.safeParse(pad).success, true);
	const invalid = [
		{ ...pad, kind: "circle", width: 1.8, height: 1.8 },
		{ ...pad, pad: { ...pad.pad, slot: 0.7 } },
		{ ...pad, pad: { ...pad.pad, slot: 1.8 } },
		{ ...pad, width: 1.1, height: 1.8 },
		{ ...pad, pad: { number: "1", type: "smd", slot: 1.2 } },
	];
	for (const shape of invalid)
		assert.equal(editorShapeSchema.safeParse(shape).success, false);
});

const holeBounds = (pad: PadShape) => {
	const [from, to] = required(shapeHole(pad)).ends;
	return [from, to].map(({ x, y }) => [
		Number(x.toFixed(6)) + 0,
		Number(y.toFixed(6)) + 0,
	]);
};

test("choosing a slot on a tall pad turns the pad so the slot runs along its long side", () => {
	const tall = editPad(
		{
			...createPad(1, { x: 0, y: 0 }, "through-hole", "1", "F.Cu"),
			kind: "rectangle",
			width: 1.7,
			height: 3,
		},
		{ attribute: "shape", value: "rectangle" },
	);
	const slotted = editPad(tall, { attribute: "hole", value: "slot" });
	assert.deepEqual(
		[slotted.width, slotted.height, slotted.pad.slot],
		[3, 1.7, 2.3],
	);
	close(slotted.rotation, Math.PI / 2);
	assert.deepEqual(
		shapeHulls(slotted)[0]
			.points.map(({ x, y }) => [
				Number(x.toFixed(6)) + 0,
				Number(y.toFixed(6)) + 0,
			])
			.sort(),
		[
			[-0.85, -1.5],
			[-0.85, 1.5],
			[0.85, -1.5],
			[0.85, 1.5],
		],
	);
	assert.deepEqual(holeBounds(slotted), [
		[0, -0.65],
		[0, 0.65],
	]);
	assert.equal(editorShapeSchema.safeParse(slotted).success, true);
});

test("an oval pad's copper is a stadium, so clearance follows its round ends", () => {
	const [hull] = shapeHulls(shieldPad());
	assert.equal(hull.points.length, 2);
	close(hull.radius, 0.55);
	close(hull.points[0].y, -0.35);
	close(hull.points[1].y, 0.35);
	const beside = shapeHulls(createPad(2, { x: 1, y: 1.4 }, "smd", "2", "F.Cu"));
	const square = shapeHulls(
		editPad(shieldPad(), { attribute: "shape", value: "rectangle" }),
	);
	assert.ok(hullDistance(hull, beside[0]) > 0);
	assert.ok(hullDistance(square[0], beside[0]) <= 0);
});

const fabrication = (pads: readonly PadShape[]) =>
	Object.fromEntries(
		exportFabrication("board", pads, [], 0.05).map((file) => [
			file.name.replace("board-", ""),
			file.content,
		]),
	);

test("Gerber flashes square-on oval pads with an O aperture and grows the mask opening", () => {
	const files = fabrication([shieldPad(0, 1, 2), shieldPad(Math.PI / 2, 5, 2)]);
	const copper = required(files["F_Cu.gtl"]);
	assert.match(copper, /%ADD\d+O,1\.1X1\.8\*%/);
	assert.match(copper, /%ADD\d+O,1\.8X1\.1\*%/);
	assert.equal(copper.match(/D03\*/g)?.length, 2);
	for (const mask of [files["F_Mask.gts"], files["B_Mask.gbs"]])
		assert.match(required(mask), /%ADD\d+O,1\.2X1\.9\*%/);
	assert.match(required(files["B_Cu.gbl"]), /%ADD\d+O,1\.1X1\.8\*%/);
	const parsed = parseGerber(copper, "F_Cu.gtl").object.objects;
	const turned = required(parsed.find((object) => object.bounds.minX > 3));
	close(turned.bounds.maxX - turned.bounds.minX, 1.8);
	close(turned.bounds.maxY - turned.bounds.minY, 1.1);
});

test("Gerber flashes an oval pad at an angle with a rotated oval macro", () => {
	const files = fabrication([shieldPad(Math.PI / 4)]);
	const copper = required(files["F_Cu.gtl"]);
	assert.doesNotMatch(copper, /O,|D01\*/);
	assert.match(copper, /%AMOval\*/);
	assert.match(
		copper,
		/%ADD\d+Oval,1\.1X0\.247487X-0\.247487X-0\.247487X0\.247487\*%/,
	);
	assert.match(copper, /D03\*/);
	const [flash] = parseGerber(copper, "F_Cu.gtl").object.objects;
	const reach = 0.35 * Math.SQRT1_2 + 0.55;
	close(flash.bounds.maxX - flash.bounds.minX, 2 * reach);
	close(flash.bounds.maxY - flash.bounds.minY, 2 * reach);
	assert.match(
		required(files["F_Mask.gts"]),
		/%ADD\d+Oval,1\.2X0\.247487X-0\.247487X-0\.247487X0\.247487\*%/,
	);
});

test("Excellon routes each slot with G85 between its end centers, using the slot width", () => {
	const drill = required(fabrication([shieldPad(0, 2, 3)])["PTH.drl"]);
	assert.match(drill, /T1C0\.700/);
	assert.match(drill, /X2\.000Y2\.750G85X2\.000Y3\.250\nG05/);
	const angled = required(
		fabrication([shieldPad(Math.PI / 6 - Math.PI / 2, 1, 1)])["PTH.drl"],
	);
	assert.match(angled, /X0\.783Y0\.875G85X1\.217Y1\.125\nG05/);
	const round = required(
		fabrication([createPad(1, { x: 1, y: 1 }, "through-hole", "1", "F.Cu")])[
			"PTH.drl"
		],
	);
	assert.match(round, /\nX1\.000Y1\.000\n/);
	assert.doesNotMatch(round, /G85/);
	const barely = shieldPad(0, 1, 1);
	const hairline = required(
		fabrication([{ ...barely, pad: { ...barely.pad, slot: 0.7004 } }])[
			"PTH.drl"
		],
	);
	assert.match(hairline, /\nX1\.000Y1\.000\n/);
	assert.doesNotMatch(hairline, /G85/);
	const nearZero = shieldPad(0, 1, 0);
	const signed = required(
		fabrication([{ ...nearZero, pad: { ...nearZero.pad, slot: 0.7006 } }])[
			"PTH.drl"
		],
	);
	assert.match(signed, /\nX1\.000Y0\.000\n/);
	assert.doesNotMatch(signed, /G85|-0\.000/);
});

test("the 2D and board views draw the oval and its slot", () => {
	const pad = shieldPad();
	const [shown] = buildStaticDisplay([pad], new Set()).shapes;
	assert.equal(shown.geometry.cornerRadius, 0.55);
	const hole = required(
		shown.children?.find((child) => child.key.endsWith(":hole")),
	);
	assert.deepEqual(
		[
			hole.geometry.kind,
			hole.geometry.width,
			hole.geometry.height,
			hole.geometry.cornerRadius,
		],
		["rectangle", 1.2, 0.7, 0.35],
	);
	const plans = planFootprintBoard([pad]);
	const drills = required(
		plans.find((plan) => plan.id === "footprint:drill"),
	).build();
	const slot = drills.objects[0].geometry;
	assert.equal(slot.type, "line");
	assert.ok(slot.type === "line" && slot.width === 0.7);
	close(drills.objects[0].bounds.maxY - drills.objects[0].bounds.minY, 1.2);
});
