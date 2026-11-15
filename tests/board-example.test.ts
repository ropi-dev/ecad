import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBoard } from "@ecad/drawing-core/board/drc.ts";
import { boardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import { fillReach, fillZones } from "#/board/fill.ts";
import { boardFileSchema } from "#/board/format.ts";
import { exportFabrication } from "#/board/gerber.ts";
import { exampleDesigns } from "#/examples/designs.ts";
import { parseGerber } from "#/formats/gerber/index.ts";

test("the RP2350A reference board is fully routed, passes DRC and exports readable Gerbers", async () => {
	const design = await exampleDesigns.rp2350a.load();
	const board = boardFileSchema.parse({
		units: "mm",
		name: design.name,
		circuitId: design.circuit.id,
		rules: design.rules,
		shapes: design.board,
	});
	const netlist = boardNetlist(design.circuit);
	assert.equal(design.circuit.components.length, 37);
	const fills = fillZones(board.shapes, netlist, board.rules);
	assert.equal(fills.length, 2);
	assert.deepEqual(
		checkBoard(board.shapes, netlist, board.rules, {
			zoneReach: fillReach(fills),
		}),
		[],
	);
	const files = exportFabrication("rp2350a", board.shapes, fills);
	assert.equal(files.length, 10);
	for (const file of files.filter((entry) => !entry.name.endsWith(".drl"))) {
		const result = parseGerber(file.content, file.name);
		assert.ok(
			result.diagnostics.every(
				(diagnostic) => diagnostic.severity === "warning",
			),
			`${file.name}: ${result.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
		);
		assert.ok(result.object.objects.length > 0, file.name);
	}
	const drill = files.find((entry) => entry.name.endsWith(".drl"));
	assert.match(drill?.content ?? "", /^T1C0\.300$/m);
});
