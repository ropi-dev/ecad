import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import {
	createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { drawShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { executeDrawingOperation } from "@ecad/drawing-core/mcp/drawing-protocol.ts";
import { Effect } from "effect";

const shapes = Array.from({ length: 5000 }, (_, index) =>
	drawShape(
		index + 1,
		"wire",
		{ x: (index % 100) * 20, y: Math.floor(index / 100) * 20 },
		{ x: (index % 100) * 20 + 10, y: Math.floor(index / 100) * 20 },
	),
);
const firstReads: number[] = [];
const repeatedReads: number[] = [];
for (let run = 0; run < 3; run++) {
	const store = createDrawingStore(shapes);
	for (let read = 0; read < 6; read++) {
		const start = performance.now();
		const reply = Effect.runSync(
			executeDrawingOperation({ type: "getDrawing" }).pipe(
				Effect.provideService(DrawingStore, store),
			),
		);
		const elapsed = performance.now() - start;
		assert.ok(reply.ok);
		assert.equal(reply.drawing?.nets?.length, 5000);
		(read === 0 ? firstReads : repeatedReads).push(elapsed);
	}
}
const p95 = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const report = {
	environment: {
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		cpuThrottle: 1,
	},
	workload: {
		disconnectedWires: 5000,
		stores: 3,
		repeatedReadsPerStore: 5,
		excludesSerialization: true,
	},
	firstReadP95Ms: p95(firstReads),
	repeatedReadP95Ms: p95(repeatedReads),
	firstReads,
	repeatedReads,
	budgets: { firstReadP95Ms: 250, repeatedReadP95Ms: 25 },
};
mkdirSync("perf-artifacts", { recursive: true });
const baseline = process.argv.includes("--baseline");
writeFileSync(
	`perf-artifacts/named-nets-5000-${baseline ? "before" : "after"}.json`,
	`${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report));
if (!baseline) {
	assert.ok(report.firstReadP95Ms < report.budgets.firstReadP95Ms);
	assert.ok(report.repeatedReadP95Ms < report.budgets.repeatedReadP95Ms);
}
