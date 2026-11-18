import assert from "node:assert/strict";
import test, { after } from "node:test";
import { strToU8, zipSync } from "fflate";
import { Box3, type Mesh } from "three";
import { compilePlanarGeometry } from "#/engine/planar-geometry.ts";
import {
	createPlanarObject3D,
	disposePlanarObject3D,
	stylePlanarObject3D,
} from "#/engine/planar-object.ts";
import { buildPlanarWalls } from "#/engine/planar-walls.ts";
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
		[0.87, 0.855, 0.835, 0.267, -0.267, -0.835, -0.855, 0, 0, 0.95],
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
		buildPlanarWalls(compiled.edges, "barrel", DRILL_WALL),
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
	assert.ok(Math.abs(bounds.min.z + 0.835) < 1e-6);
	assert.ok(Math.abs(bounds.max.z - 0.835) < 1e-6);
	stylePlanarObject3D(object, "#ffaa00", 1, false);
	assert.equal(barrel.visible, false);
	assert.equal(part("fill").visible, true);
	disposePlanarObject3D(object);
});
