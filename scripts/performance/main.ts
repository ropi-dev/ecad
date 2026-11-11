import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../development/common.ts";
import { grepForTitles } from "./ab.ts";
import { cacheRoot } from "./base-build.ts";
import { withoutGrep } from "./options.ts";

export interface MainState {
	sha: string;
	checkedAt: string;
}

export interface MainOptions {
	since?: string;
	accept: boolean;
	args: string[];
}

export function parseMain(argv: readonly string[]): MainOptions {
	const options: MainOptions = { accept: false, args: [] };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--accept") options.accept = true;
		else if (arg === "--since") {
			const value = argv[++index];
			if (!value) throw new Error("--since needs a Git ref.");
			options.since = value;
		} else if (arg.startsWith("--since=")) options.since = arg.slice(8);
		else if (arg === "--base" || arg.startsWith("--base="))
			throw new Error("perf:main takes --since <ref>, not --base.");
		else options.args.push(arg);
	}
	return options;
}

export type Step =
	| { kind: "seed" }
	| { kind: "current" }
	| { kind: "compare"; base: string }
	| { kind: "error"; message: string };

export function nextStep(input: {
	head: string;
	base?: string;
	clean: boolean;
	onMain: boolean;
	baseIsAncestor: boolean;
}): Step {
	if (!input.base)
		return input.clean && input.onMain
			? { kind: "seed" }
			: {
					kind: "error",
					message:
						"No checked commit is recorded yet. Run from a clean checkout of origin/main to record one, or pass --since <ref>.",
				};
	if (input.base === input.head && input.clean) return { kind: "current" };
	if (!input.baseIsAncestor)
		return {
			kind: "error",
			message: `${input.base.slice(0, 12)} is not an ancestor of HEAD. Pass --since <ref> with a commit HEAD contains.`,
		};
	return { kind: "compare", base: input.base };
}

export interface AbReport {
	kind?: string;
	timestamp?: string;
	failures?: string[];
	scenarios?: Record<string, { test: string; verdict: string }>;
}

export function regressions(report: AbReport): {
	scenarios: string[];
	tests: string[];
	other: number;
} {
	const regressed = Object.entries(report.scenarios ?? {}).filter(
		([, scenario]) => scenario.verdict === "regression",
	);
	return {
		scenarios: regressed.map(([name]) => name),
		tests: [...new Set(regressed.map(([, scenario]) => scenario.test))],
		other: Math.max(0, (report.failures?.length ?? 0) - regressed.length),
	};
}

export const statePath = (env = process.env) =>
	join(cacheRoot(env), "main-check.json");

export function readState(path = statePath()): MainState | undefined {
	try {
		const state = JSON.parse(readFileSync(path, "utf8"));
		return typeof state?.sha === "string" ? state : undefined;
	} catch {
		return undefined;
	}
}

export function writeState(sha: string, path = statePath()): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		JSON.stringify({ sha, checkedAt: new Date().toISOString() }, null, 2),
	);
}

const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" });

function readReport(since: number): AbReport | undefined {
	try {
		const report: AbReport = JSON.parse(
			readFileSync("perf-artifacts/latest.json", "utf8"),
		);
		return report.kind === "ab" &&
			Date.parse(report.timestamp ?? "") >= since - 1000
			? report
			: undefined;
	} catch {
		return undefined;
	}
}

async function main(): Promise<number> {
	const options = parseMain(process.argv.slice(2));
	if (git(["fetch", "--quiet", "origin", "main"]).status !== 0)
		console.warn(
			"[perf] Could not fetch origin/main. Using the local copy of it.",
		);
	const head = git(["rev-parse", "HEAD"]).stdout.trim();
	const clean = !git(["status", "--porcelain"]).stdout.trim();
	const onMain =
		git(["merge-base", "--is-ancestor", "HEAD", "origin/main"]).status === 0;
	const unrecorded = !clean
		? "the checkout has uncommitted changes"
		: !onMain
			? "HEAD is not on origin/main"
			: undefined;
	const record = () => {
		writeState(head);
		console.log(
			`[perf] Recorded ${head.slice(0, 12)} as the checked main commit in ${statePath()}.`,
		);
	};
	if (options.accept) {
		if (unrecorded) {
			console.error(`[perf] Cannot accept: ${unrecorded}.`);
			return 1;
		}
		record();
		return 0;
	}
	const state = readState();
	let base = state?.sha;
	if (options.since) {
		const resolved = git([
			"rev-parse",
			"--verify",
			`${options.since}^{commit}`,
		]);
		if (resolved.status !== 0) {
			console.error(`[perf] --since ${options.since} is not a commit.`);
			return 1;
		}
		base = resolved.stdout.trim();
	}
	const step = nextStep({
		head,
		base,
		clean,
		onMain,
		baseIsAncestor:
			Boolean(base) &&
			git(["merge-base", "--is-ancestor", base as string, "HEAD"]).status === 0,
	});
	if (step.kind === "error") {
		console.error(`[perf] ${step.message}`);
		return 1;
	}
	if (step.kind === "seed") {
		record();
		console.log("[perf] Nothing to compare yet. The next run starts here.");
		return 0;
	}
	if (step.kind === "current") {
		console.log(
			`[perf] No commits since the last check of ${head.slice(0, 12)}${state?.sha === head ? ` on ${state.checkedAt}` : ""}. Nothing was run.`,
		);
		return 0;
	}
	const commits = git([
		"log",
		"--oneline",
		"--first-parent",
		`${step.base}..HEAD`,
	]).stdout.trim();
	const count = commits ? commits.split("\n").length : 0;
	console.log(
		`[perf] Main check: ${head.slice(0, 12)} against ${step.base.slice(0, 12)}, ${count} commit${count === 1 ? "" : "s"}.`,
	);
	if (commits) console.log(commits.replace(/^/gm, "[perf]   "));
	const runner = fileURLToPath(new URL("./run.ts", import.meta.url));
	const perf = (args: string[]) =>
		run(process.execPath, [
			"--import",
			"tsx",
			runner,
			"--base",
			step.base,
			...args,
		]);
	let started = Date.now();
	let status = await perf(options.args);
	const found = regressions(readReport(started) ?? {});
	if (status !== 0 && found.tests.length && !found.other) {
		console.log(
			`[perf] Rerunning ${found.scenarios.join(", ")} to confirm the regression verdict${found.scenarios.length === 1 ? "" : "s"}.`,
		);
		const pattern = grepForTitles(found.tests);
		started = Date.now();
		status = await perf([
			...withoutGrep(options.args).filter((arg) => arg !== "--all"),
			"--grep",
			pattern,
		]);
		const confirmed = regressions(readReport(started) ?? {});
		if (status === 0)
			console.log(
				`[perf] Not reproduced, so treated as noise: ${found.scenarios.join(", ")}.`,
			);
		else if (confirmed.scenarios.length) {
			console.error(
				`[perf] Confirmed in two runs: ${confirmed.scenarios.join(", ")}.`,
			);
			if (count > 1)
				console.error(
					`[perf] To find the commit, check out each of the ${count} commits above and run: pnpm run perf --base ${step.base.slice(0, 12)} --grep '${grepForTitles(confirmed.tests)}'`,
				);
		}
	}
	if (status !== 0) {
		console.error(
			`[perf] Main check failed. ${step.base.slice(0, 12)} stays the checked commit. After a fix or an accepted slowdown, run pnpm run perf:main --accept.`,
		);
		return status;
	}
	if (unrecorded) console.log(`[perf] Passed. Not recorded: ${unrecorded}.`);
	else record();
	return 0;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		process.exitCode = await main();
	} catch (error) {
		console.error(
			`[perf] ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
