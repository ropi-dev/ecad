import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { prepareArtifacts } from "../development/artifacts.ts";
import { plan } from "./select.ts";

prepareArtifacts();
const args = process.argv.slice(2);
const development = args.includes("--development");
const baseline = args.includes("--baseline");
const selection = plan(
	args.filter((arg) => arg !== "--development" && arg !== "--baseline"),
	{
		baseline,
		smoke: process.env.ECAD_PERF_SMOKE === "1",
		base: process.env.ECAD_PERF_BASE,
	},
);
for (const message of selection.messages) console.log(message);
const forwarded = selection.args;
const env = {
	...process.env,
	ECAD_PERF_MODE: development ? "development" : "production",
	ECAD_PERF_UPDATE_BASELINE: baseline ? "1" : "0",
	ECAD_PERF_BASELINE_PATH:
		process.env.ECAD_PERF_BASELINE_PATH ??
		(development
			? "perf-artifacts/development-baseline.json"
			: "perf-artifacts/baseline.json"),
};
mkdirSync("perf-artifacts", { recursive: true });
for (const target of development ? ["build:cli"] : ["build:web", "build:cli"]) {
	console.log(
		`[perf] Running ${target}. Build output goes to perf-artifacts/build.log.`,
	);
	const build = spawnSync(
		process.platform === "win32" ? "pnpm.cmd" : "pnpm",
		["run", target],
		{ encoding: "utf8", env },
	);
	writeFileSync(
		"perf-artifacts/build.log",
		(build.stdout ?? "") + (build.stderr ?? ""),
		{ flag: target === (development ? "build:cli" : "build:web") ? "w" : "a" },
	);
	if (build.status !== 0) {
		console.error(build.error ?? "Build failed. See perf-artifacts/build.log.");
		process.exit(build.status ?? 1);
	}
}
const run = spawnSync(
	process.platform === "win32" ? "pnpm.cmd" : "pnpm",
	[
		"exec",
		"playwright",
		"test",
		"--config",
		"tests/performance/playwright.config.ts",
		...forwarded,
	],
	{ stdio: "inherit", env },
);
if (run.error) console.error(run.error);
process.exit(run.status ?? 1);
