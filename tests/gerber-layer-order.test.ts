import assert from "node:assert/strict";
import test, { after } from "node:test";
import { strToU8, zipSync } from "fflate";
import { Box3, type Mesh } from "three";
import { compilePlanarGeometry } from "#/engine/planar-geometry.ts";
import { offsetRing, planarRings } from "#/engine/planar-holes.ts";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
	stylePlanarObject3D,
} from "#/engine/planar-object.ts";
import { expandGerberFile } from "#/formats/expandGerberFile.ts";
import {
	DRILL_WALL,
	isDrillLayer,
	placeBoardLayers,
} from "#/formats/gerber/board-stack.ts";
import { gerberLayerOrder } from "#/formats/gerber/layer-order.ts";
import { installArchiveWorker } from "./helpers/archive-worker";

after(installArchiveWorker().restore);

const source = (fileFunction = "") =>
	`${fileFunction ? `%TF.FileFunction,${fileFunction}*%` : ""}%FSLAX46Y46*%%MOMM*%%ADD10C,1*%D10*X0Y0D03*M02*`;

test("ZIP Gerbers follow the physical stack in the panel, including numeric inner layers", async () => {
	const layers = [
		["silk-top.gbr", "Legend,Top"],
		["paste-top.gbr", "Paste,Top"],
		["mask-top.gbr", "Soldermask,Top"],
		["copper-top.gbr", "Copper,L1,Top"],
		["inner-two.gbr", "Copper,L2,Inr"],
		["inner-ten.gbr", "Copper,L10,Inr"],
		["copper-bottom.gbr", "Copper,L12,Bot"],
		["mask-bottom.gbr", "Soldermask,Bot"],
		["paste-bottom.gbr", "Paste,Bot"],
		["silk-bottom.gbr", "Legend,Bot"],
		["profile.gbr", "Profile,NP"],
		["holes.gbr", "Drillmap"],
		["unknown.gbr", ""],
	];
	const shuffled = [5, 11, 1, 7, 3, 12, 9, 4, 0, 10, 6, 2, 8];
	const archive = zipSync(
		Object.fromEntries(
			shuffled.map((index) => [
				`board/${layers[index][0]}`,
				strToU8(source(layers[index][1])),
			]),
		),
	);
	const { files, messages } = await expandGerberFile(
		new File([new Uint8Array(archive)], "board.zip"),
		new AbortController().signal,
	);
	assert.deepEqual(messages, []);
	assert.deepEqual(
		files.map((file) => file.name).reverse(),
		layers.map(([name]) => `board/${name}`),
	);
	assert.equal(await files.at(-1)?.text(), source("Legend,Top"));
});

test("legacy layer names and extensions match the metadata order", () => {
	const cases = [
		["board-F_Silkscreen.gbr", "Legend,Top"],
		["board.gto", "Legend,Top"],
		["board-F.Paste.gbr", "Paste,Top"],
		["board.gtp", "Paste,Top"],
		["board-F_Mask.gbr", "Soldermask,Top"],
		["board.gts", "Soldermask,Top"],
		["board-F_Cu.gbr", "Copper,L1,Top"],
		["board.gtl", "Copper,L1,Top"],
		["board-B_Cu.gbr", "Copper,L4,Bot"],
		["board.gbl", "Copper,L4,Bot"],
		["board-B_Mask.gbr", "Soldermask,Bot"],
		["board.gbs", "Soldermask,Bot"],
		["board-B_Paste.gbr", "Paste,Bot"],
		["board.gbp", "Paste,Bot"],
		["board-B_SilkS.gbr", "Legend,Bot"],
		["board.gbo", "Legend,Bot"],
		["board-Edge_Cuts.gm1", "Profile,NP"],
		["board.gko", "Profile,NP"],
		["board-PTH-drl_map.gbr", "Drillmap"],
		["board-NPTH-drl_map.gbr", "Drillmap"],
	];
	for (const [name, attribute] of cases)
		assert.deepEqual(
			gerberLayerOrder(name, source()),
			gerberLayerOrder("unknown.gbr", source(attribute)),
			name,
		);
	assert.deepEqual(gerberLayerOrder("board-In10_Cu.gbr", ""), [4, 10]);
	assert.deepEqual(gerberLayerOrder("board.g2", ""), [4, 2]);
	assert.deepEqual(gerberLayerOrder("board.gl10", ""), [4, 10]);
});

test("attributes override filenames, including legacy comment attributes", () => {
	assert.deepEqual(
		gerberLayerOrder("wrong.gbl", source("Copper,L1,Top")),
		[3, 0],
	);
	assert.deepEqual(
		gerberLayerOrder("wrong.gtl", "G04 #@! TF.FileFunction,Copper,L4,Bot*"),
		[5, 0],
	);
});

test("standalone imports preserve their file identity", async () => {
	const file = new File([source("Copper,L1,Top")], "board.gbr");
	assert.deepEqual(
		(await expandGerberFile(file, new AbortController().signal)).files,
		[file],
	);
});

test("3D board heights follow layer names and file functions", () => {
	const layer = (name: string, fileFunction?: string) => ({
		name,
		metadata: fileFunction
			? { ".FileFunction": fileFunction.split(",") }
			: ({} as Record<string, string[]>),
	});
	const placements = placeBoardLayers([
		layer("board-F_Silkscreen.gbr"),
		layer("board-F_Mask.gbr"),
		layer("board-F_Cu.gbr"),
		layer("board-In1_Cu.gbr"),
		layer("copper.gbr", "Copper,L3,Inr"),
		layer("board-B_Cu.gbr"),
		layer("board.GBS"),
		layer("board-Edge_Cuts.gbr"),
		layer("board-PTH.gbr"),
		layer("notes.gbr"),
	]);
	assert.deepEqual(
		placements.map(({ z }) => Number(z.toFixed(3))),
		[1, 0.92, 0.87, 0.267, -0.267, -0.87, -0.92, 0, 0, 1.04],
	);
	assert.deepEqual(
		placements.map(({ through }) => through),
		[false, false, false, false, false, false, false, true, true, false],
	);
});

test("drill layers become barrels that span the board in 3D", () => {
	const objects = [
		{
			id: "hole",
			geometry: { type: "circle" as const, x: 2, y: 3, radius: 0.5 },
			bounds: { minX: 1.5, minY: 2.5, maxX: 2.5, maxY: 3.5 },
			polarity: "dark" as const,
			attributes: {},
		},
	];
	const drill = {
		name: "board-PTH-drl.gbr",
		metadata: { ".FileFunction": ["Plated", "1", "4", "PTH"] },
	};
	assert.equal(isDrillLayer(drill), true);
	assert.equal(isDrillLayer({ name: "board-F_Cu.gbr", metadata: {} }), false);
	const compiled = compilePlanarGeometry(objects);
	const object = createPlanarObject3D(
		{
			...drill,
			id: "drill",
			objects,
			bounds: objects[0].bounds,
			color: "#ffaa00",
			visible: true,
			opacity: 1,
			type: "planar",
		},
		compiled,
		{ extrude: "barrel", wall: DRILL_WALL },
	);
	const part = (name: string) =>
		object.children.find((child) => child.userData.planarPart === name) as Mesh;
	const barrel = part("walls");
	assert.equal(
		barrel.geometry.getAttribute("position").count,
		(compiled.edges.length / 6) * 24,
	);
	const radii: number[] = [];
	const position = barrel.geometry.getAttribute("position");
	for (let index = 0; index < position.count; index++)
		radii.push(Math.hypot(position.getX(index) - 2, position.getY(index) - 3));
	assert.ok(Math.abs(Math.max(...radii) - 0.5) < 1e-3);
	assert.ok(Math.abs(Math.min(...radii) - (0.5 - DRILL_WALL)) < 0.01);
	stylePlanarObject3D(
		object,
		"#ffaa00",
		1,
		false,
		placeBoardLayers([drill])[0],
	);
	assert.equal(barrel.visible, true);
	assert.equal(part("fill").visible, false);
	const bounds = new Box3().setFromObject(barrel);
	assert.ok(Math.abs(bounds.min.z + 1.01) < 1e-6);
	assert.ok(Math.abs(bounds.max.z - 1.01) < 1e-6);
	stylePlanarObject3D(object, "#ffaa00", 1, false);
	assert.equal(barrel.visible, false);
	assert.equal(part("fill").visible, true);
	disposePlanarObject3D(object);
});

test("surface layers extrude inward from their outer face in 3D", () => {
	const objects = [
		{
			id: "pad",
			geometry: { type: "rect" as const, x: 0, y: 0, width: 2, height: 1 },
			bounds: { minX: -1, minY: -0.5, maxX: 1, maxY: 0.5 },
			polarity: "dark" as const,
			attributes: {},
		},
	];
	const compiled = compilePlanarGeometry(objects);
	for (const [name, top, bottom] of [
		["board-F_Cu.gbr", 0.87, 0.8],
		["board-B_Mask.gbr", -0.87, -0.92],
	] as const) {
		const layer = { name, metadata: {} };
		const object = createPlanarObject3D(
			{
				...layer,
				id: name,
				objects,
				bounds: objects[0].bounds,
				color: "#ffaa00",
				visible: true,
				opacity: 1,
				type: "planar",
			},
			compiled,
			{ extrude: "slab" },
		);
		const placement = placeBoardLayers([layer])[0];
		object.position.z = placement.z;
		const board = { minX: -10, minY: -5, maxX: 30, maxY: 15 };
		stylePlanarObject3D(object, "#ffaa00", 1, false, {
			...placement,
			sheet: board,
		});
		const sheet = object.children.find(
			(child) => child.userData.planarPart === "sheet",
		) as Mesh;
		assert.equal(sheet.visible, true);
		const walls = object.children.find(
			(child) => child.userData.planarPart === "walls",
		) as Mesh;
		assert.equal(walls.visible, true);
		assert.equal(
			walls.geometry.getAttribute("position").count,
			(compiled.edges.length / 6) * 6,
		);
		object.updateMatrixWorld(true);
		const bounds = new Box3().setFromObject(walls);
		assert.ok(Math.abs(bounds.max.z - top) < 1e-6, `${name} top`);
		assert.ok(Math.abs(bounds.min.z - bottom) < 1e-6, `${name} bottom`);
		const sheetBounds = new Box3().setFromObject(sheet);
		assert.deepEqual(
			[
				sheetBounds.min.x,
				sheetBounds.min.y,
				sheetBounds.max.x,
				sheetBounds.max.y,
			],
			[board.minX, board.minY, board.maxX, board.maxY],
		);
		assert.ok(Math.abs(sheetBounds.min.z - (top + bottom) / 2) < 1e-6);
		stylePlanarObject3D(object, "#ffaa00", 1, false);
		assert.equal(walls.visible, false);
		assert.equal(sheet.visible, false);
		object.updateMatrixWorld(true);
		const hiddenSheet = new Box3().setFromObject(sheet);
		assert.deepEqual(
			[hiddenSheet.min.x, hiddenSheet.max.x],
			[objects[0].bounds.minX, objects[0].bounds.maxX],
		);
		disposePlanarObject3D(object);
	}
});

test("hole walls offset inward and stay open in tiny holes", () => {
	const square: [number, number][] = [
		[0, 0],
		[2, 0],
		[2, 2],
		[0, 2],
	];
	const inner = offsetRing(square, 0.1);
	assert.deepEqual(
		inner.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]),
		[
			[0.1, 0.1],
			[1.9, 0.1],
			[1.9, 1.9],
			[0.1, 1.9],
		],
	);
	assert.deepEqual(
		offsetRing([...square].reverse(), 0.1).map(([x]) => Number(x.toFixed(6))),
		[0.1, 1.9, 1.9, 0.1],
	);
	const tiny = offsetRing(
		square.map(([x, y]) => [x * 0.05, y * 0.05] as [number, number]),
		0.1,
	);
	assert.ok(tiny[2][0] - tiny[0][0] > 0);
	const compiled = compilePlanarGeometry([
		{
			id: "a",
			geometry: { type: "circle", x: 0, y: 0, radius: 1 },
			bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
			polarity: "dark",
			attributes: {},
		},
		{
			id: "b",
			geometry: { type: "circle", x: 5, y: 0, radius: 1 },
			bounds: { minX: 4, minY: -1, maxX: 6, maxY: 1 },
			polarity: "dark",
			attributes: {},
		},
	]);
	assert.equal(planarRings(compiled.edges).length, 2);
});
