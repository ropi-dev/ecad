import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareArtifacts } from "../development/artifacts.ts";
import { run, runLocked } from "../development/common.ts";
import { decisionFromEnv } from "./ab.ts";
import { markInUse } from "./base-build.ts";
import { type Plan, parseRun } from "./options.ts";
import { plan as selectScenarios } from "./select.ts";

// Builds run under shared access to the host benchmark lock; the worker then
// measures under exclusive access.
const started = Date.now();
prepareArtifacts();
const parsed = parseRun(process.argv.slice(2), process.env);
if (parsed.mode === "deprecated-baseline") {
	console.log(
		"[perf] perf:baseline is no longer needed: pnpm run perf compares the affected scenarios against the merge base in one session. Nothing was run. Use pnpm run perf:budgets for the absolute budget run.",
	);
	process.exit(0);
}
const planned: Plan = { mode: parsed.mode, args: parsed.args, started };
if (parsed.mode === "ab") {
	try {
		decisionFromEnv(process.env);
	} catch (error) {
		console.error(
			`[perf] ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
}
if (parsed.mode === "budgets") {
	if (!parsed.grep)
		console.log(
			"[perf] Budget run: every scenario, 4× CPU throttle. Pass --grep to narrow it.",
		);
} else {
	const selection = selectScenarios(parsed.args, {
		baseline: parsed.mode === "development" && parsed.updateBaseline,
		smoke: parsed.mode === "smoke",
		base: parsed.baseRef,
	});
	for (const message of selection.messages) console.log(message);
	planned.args = selection.args;
}
planned.updateBaseline = parsed.updateBaseline;

const alreadyLocked = process.env.ECAD_PERF_LOCK_HELD === "1";
const queued = !alreadyLocked && process.platform === "linux";
if (!queued && !alreadyLocked)
	console.warn(
		"[ecad] The host benchmark queue is Linux-only. Running native perf without the shared queue.",
	);
// Builds hold shared access to the benchmark lock, so they can overlap other
// builds and tests but never a benchmark's measurement.
mkdirSync("perf-artifacts", { recursive: true });
const result = resolve("perf-artifacts/plan.json");
rmSync(result, { force: true });
const builder = [
	"--import",
	"tsx",
	fileURLToPath(new URL("./build.ts", import.meta.url)),
	result,
];
const buildEnv = {
	...process.env,
	ECAD_PERF_PLAN: JSON.stringify(planned),
	ECAD_PERF_BASE_REF: parsed.baseRef,
};
const built = await (queued
	? runLocked("perf", process.execPath, builder, buildEnv, true)
	: run(process.execPath, builder, buildEnv));
if (built !== 0 || !existsSync(result)) process.exit(built || 1);
Object.assign(planned, JSON.parse(readFileSync(result, "utf8")));
// Pruning skips a base build while this run uses it.
if (planned.base) markInUse(planned.base.directory);

const args = [
	"--import",
	"tsx",
	fileURLToPath(new URL("./worker.ts", import.meta.url)),
];
const env = {
	...process.env,
	ECAD_PERF_PLAN: JSON.stringify(planned),
	ECAD_PERF_LOCK_HELD: "1",
};
process.exitCode = await (queued
	? runLocked("perf", process.execPath, args, env)
	: run(process.execPath, args, env));
