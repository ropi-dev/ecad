import { writeFileSync } from "node:fs";
import {
	analyzeConnectivity,
	copperItems,
} from "@ecad/drawing-core/board/connectivity.ts";
import { checkBoard } from "@ecad/drawing-core/board/drc.ts";
import { boardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import { fillReach, fillZones } from "#/board/fill.ts";
import { persistProjectDrawingShapes } from "#/drawing/symbol-persistence.ts";
import type { ExampleDesign } from "#/examples/designs.ts";
import {
	rp2350aBoard,
	rp2350aCircuit,
	rp2350aSchematic,
	rp2350aSheet,
} from "#/examples/rp2350a.ts";
import { boardSvg } from "./board-svg.ts";

const started = performance.now();
const schematic = rp2350aSchematic();
const { shapes, file } = rp2350aCircuit(schematic);
console.log(
	`schematic: ${shapes.length} shapes, ${file.circuit.components.length} components, ${file.circuit.nets.length} nets`,
);
const { board, failed } = rp2350aBoard(
	file,
	shapes,
	process.env.ECAD_TRACE ? (message) => console.log(message) : undefined,
);
const netlist = boardNetlist(file.circuit);
const fills = fillZones(board.shapes, netlist, board.rules);
const findings = checkBoard(board.shapes, netlist, board.rules, {
	zoneReach: fillReach(fills),
});
const preview = process.env.ECAD_BOARD_SVG;
if (preview)
	writeFileSync(
		preview,
		boardSvg(
			board.shapes,
			fills,
			analyzeConnectivity(copperItems(board.shapes, netlist), fillReach(fills))
				.ratsnest,
		),
	);
const counts = new Map<string, number>();
for (const finding of findings)
	counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
console.log(
	`board: ${board.shapes.length} shapes, failed routes ${failed}, DRC ${JSON.stringify(Object.fromEntries(counts))} in ${Math.round(performance.now() - started)} ms`,
);
for (const finding of findings.slice(0, 30)) console.log(" ", finding.message);

if (process.argv.includes("--write")) {
	const design: ExampleDesign = {
		name: "RP2350A",
		schematic: persistProjectDrawingShapes({ shapes, symbols: [] }),
		sheet: rp2350aSheet,
		circuit: file.circuit,
		rules: board.rules,
		board: board.shapes,
	};
	const target = new URL(
		"../../packages/core/src/examples/rp2350a-design.json",
		import.meta.url,
	);
	writeFileSync(target, `${JSON.stringify(design)}\n`);
	console.log(`wrote ${target.pathname}`);
}
