import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBoard } from "@ecad/drawing-core/board/drc.ts";
import { boardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import {
	savedSheet,
	sheetPaper,
	sheetSettingsSchema,
} from "@ecad/drawing-core/drawing/sheet.ts";
import { fillReach, fillZones } from "#/board/fill.ts";
import { boardFileSchema } from "#/board/format.ts";
import { exportFabrication } from "#/board/gerber.ts";
import { exampleDesigns } from "#/examples/designs.ts";
import { rp2350aSheet } from "#/examples/rp2350a.ts";
import { parseGerber } from "#/formats/gerber/index.ts";

test("the RP2350A example is a fully routed board that passes the check and exports Gerbers a fab can read", async () => {
	const design = await exampleDesigns.rp2350a.load();
	const board = boardFileSchema.parse({
		units: "mm",
		name: design.name,
		circuitId: design.circuit.id,
		rules: design.rules,
		shapes: design.board,
	});
	const netlist = boardNetlist(design.circuit);
	const fills = fillZones(board.shapes, netlist, board.rules);
	const ground = [...netlist.nets.values()].find((net) => net.name === "GND");
	assert.deepEqual(
		fills
			.filter((fill) => fill.net === ground?.id && fill.polygons.length)
			.map((fill) => fill.layer)
			.sort(),
		["B.Cu", "F.Cu"],
	);
	assert.deepEqual(
		checkBoard(board.shapes, netlist, board.rules, {
			zoneReach: fillReach(fills),
		}),
		[],
	);
	const files = exportFabrication("rp2350a", board.shapes, fills);
	const functions = files
		.filter((file) => !file.name.endsWith(".drl"))
		.map((file) => {
			const result = parseGerber(file.content, file.name);
			assert.ok(
				result.diagnostics.every(
					(diagnostic) => diagnostic.severity === "warning",
				),
				`${file.name}: ${result.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
			);
			assert.ok(result.object.objects.length > 0, file.name);
			return /%TF\.FileFunction,([^*]+)\*%/.exec(file.content)?.[1];
		});
	assert.deepEqual(functions.sort(), [
		"Copper,L1,Top",
		"Copper,L2,Bot",
		"Legend,Bot",
		"Legend,Top",
		"Paste,Bot",
		"Paste,Top",
		"Profile,NP",
		"Soldermask,Bot",
		"Soldermask,Top",
	]);
	const drill = files.find((file) => file.name.endsWith(".drl"));
	assert.match(drill?.content ?? "", /^T\d+C0\.300$/m);
});

test("the RP2350A schematic fills in its title block and keeps clear of it", async () => {
	const design = await exampleDesigns.rp2350a.load();
	const sheet = sheetSettingsSchema.parse(design.sheet);
	assert.deepEqual(sheet, rp2350aSheet);
	assert.deepEqual(savedSheet(sheet), sheet);
	assert.equal(sheet.title, "RP2350A QFN-60 Minimal Design Example");
	const { width, height } = sheetPaper(sheet);
	const titleBlock = {
		left: width / 2 - 12 - 108,
		top: -height / 2 + 12 + 32,
	};
	for (const shape of design.schematic as { x: number; y: number }[]) {
		assert.ok(Math.abs(shape.x) < width / 2 && Math.abs(shape.y) < height / 2);
		assert.ok(
			shape.x < titleBlock.left || shape.y > titleBlock.top,
			`shape at ${shape.x}, ${shape.y} is inside the title block`,
		);
	}
});
