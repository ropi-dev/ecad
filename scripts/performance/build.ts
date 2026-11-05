import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { prepareBase, resolveBase } from "./base-build.ts";
import type { Plan } from "./options.ts";

/**
 * Builds head, and for an A/B run the base, then writes the plan with the
 * base build to `argv[2]`. The launcher runs this under shared access to the
 * host benchmark lock: builds can overlap each other but never a benchmark.
 */
const [output] = process.argv.slice(2);
const planned: Plan = JSON.parse(process.env.ECAD_PERF_PLAN ?? "{}");
const baseRef = process.env.ECAD_PERF_BASE_REF ?? "origin/main";

mkdirSync("perf-artifacts", { recursive: true });
const targets =
	planned.mode === "development" ? ["build:cli"] : ["build:web", "build:cli"];
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
if (planned.mode === "ab") {
	try {
		const sha = process.env.ECAD_PERF_BASE_SHA ?? resolveBase(baseRef);
		const base = await prepareBase(sha, {
			archive: process.env.ECAD_PERF_BASE_ARCHIVE,
		});
		console.log(
			`[perf] Base ${sha.slice(0, 12)} (merge base of ${baseRef} and HEAD): ${base.built ? `built in ${(base.durationMs / 1000).toFixed(1)} s` : "cached build"}.`,
		);
		planned.base = { ref: baseRef, ...base };
	} catch (error) {
		console.error(
			`[perf] ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
}
planned.built = Date.now();
writeFileSync(output, JSON.stringify(planned));
