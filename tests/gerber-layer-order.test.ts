import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { expandGerberFile } from "#/formats/expandGerberFile.ts";
import { gerberLayerOrder } from "#/formats/gerber/layer-order.ts";

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
