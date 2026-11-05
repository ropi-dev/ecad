import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prepareArtifacts } from "../development/artifacts.ts";
import { run, runLocked } from "../development/common.ts";
import { decisionFromEnv } from "./ab.ts";
import { prepareBase, resolveBase } from "./base-build.ts";
import { type Plan, parseRun } from "./options.ts";
import { plan as selectScenarios } from "./select.ts";

// Builds run before the host benchmark lock, so the lock covers measurement
// only. The worker then measures under the lock.
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

mkdirSync("perf-artifacts", { recursive: true });
const targets =
	parsed.mode === "development" ? ["build:cli"] : ["build:web", "build:cli"];
for (const target of targets) {
	console.log(
		`[perf] Running ${target}. Build output goes to perf-artifacts/build.log.`,
	);
	const build = spawnSync(
		process.platform === "win32" ? "pnpm.cmd" : "pnpm",
		["run", target],
		{ encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
	);
	writeFileSync(
		"perf-artifacts/build.log",
		(build.stdout ?? "") + (build.stderr ?? ""),
		{ flag: target === targets[0] ? "w" : "a" },
	);
	if (build.status !== 0) {
		console.error(build.error ?? "Build failed. See perf-artifacts/build.log.");
		process.exit(build.status ?? 1);
	}
}
if (parsed.mode === "ab") {
	try {
		const sha = process.env.ECAD_PERF_BASE_SHA ?? resolveBase(parsed.baseRef);
		const base = await prepareBase(sha, {
			archive: process.env.ECAD_PERF_BASE_ARCHIVE,
		});
		console.log(
			`[perf] Base ${sha.slice(0, 12)} (merge base of ${parsed.baseRef} and HEAD): ${base.built ? `built in ${(base.durationMs / 1000).toFixed(1)} s` : "cached build"}.`,
		);
		planned.base = { ref: parsed.baseRef, ...base };
	} catch (error) {
		console.error(
			`[perf] ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
}
planned.built = Date.now();

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
const alreadyLocked = process.env.ECAD_PERF_LOCK_HELD === "1";
if (process.platform !== "linux" && !alreadyLocked)
	console.warn(
		"[ecad] The host benchmark queue is Linux-only. Running native perf without the shared queue.",
	);
process.exitCode = await (alreadyLocked || process.platform !== "linux"
	? run(process.execPath, args, env)
	: runLocked("perf", process.execPath, args, env));
