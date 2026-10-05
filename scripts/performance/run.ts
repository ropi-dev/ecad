import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const development = args.includes("--development");
const baseline = args.includes("--baseline");
const forwarded = args.filter(
	(arg) => arg !== "--development" && arg !== "--baseline",
);
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
if (!development) {
	console.log(
		"[perf] Building the app. Build output goes to perf-artifacts/build.log.",
	);
	const build = spawnSync(
		process.platform === "win32" ? "npm.cmd" : "npm",
		["run", "build:web"],
		{ encoding: "utf8", env },
	);
	writeFileSync(
		"perf-artifacts/build.log",
		(build.stdout ?? "") + (build.stderr ?? ""),
	);
	if (build.status !== 0) {
		console.error(build.error ?? "Build failed. See perf-artifacts/build.log.");
		process.exit(build.status ?? 1);
	}
}
const run = spawnSync(
	process.platform === "win32" ? "npx.cmd" : "npx",
	[
		"--no-install",
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
