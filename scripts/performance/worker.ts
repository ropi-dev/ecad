import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, resolve } from "node:path";
import {
	checkBudgets,
	type Summary,
} from "../../tests/performance/comparison.ts";
import { run } from "../development/common.ts";
import {
	decisionFromEnv,
	describeJudgement,
	grepForTitles,
	judgeScenario,
	maxRounds,
	nodeVariantScenarios,
	type Pair,
	type ScenarioJudgement,
} from "./ab.ts";
import { touch } from "./base-build.ts";
import type { Plan } from "./options.ts";
import { withoutGrep } from "./options.ts";
import { portAvailable, ServerRecord } from "./ports.ts";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const config = "tests/performance/playwright.config.ts";
const planned: Plan = JSON.parse(process.env.ECAD_PERF_PLAN ?? "{}");
const locked = Date.now();

/** Budget, smoke and development runs: one variant, as Playwright projects. */
async function single(plan: Plan): Promise<number> {
	const development = plan.mode === "development";
	const env = {
		...process.env,
		ECAD_PERF_MODE: development ? "development" : "production",
		ECAD_PERF_UPDATE_BASELINE: plan.updateBaseline ? "1" : "0",
		ECAD_PERF_RUNS: process.env.ECAD_PERF_RUNS ?? "3",
		ECAD_PERF_BASELINE_PATH:
			process.env.ECAD_PERF_BASELINE_PATH ??
			(development
				? "perf-artifacts/development-baseline.json"
				: "perf-artifacts/baseline.json"),
	};
	const result = spawnSync(
		pnpm,
		["exec", "playwright", "test", "--config", config, ...plan.args],
		{ stdio: "inherit", env },
	);
	if (result.error) console.error(result.error);
	return result.status ?? 1;
}

interface VariantOutput {
	variant: "base" | "head";
	tagFailures: string[];
	tests: { test: string; status: string; error?: string }[];
	runs: {
		test: string;
		scenario: string;
		metrics: Record<string, number>;
		report: {
			environment: { userAgent: string };
			metrics?: Record<string, { p50?: number }>;
		};
	}[];
}

/**
 * Adds `interactionP50Ms`, the median of a run's timed interactions. Each
 * scenario times only three to six interactions, so `interactionP95Ms` is
 * close to their maximum, often a cold first interaction. A 40% slower
 * rotation moved the median clearly while that maximum hid it.
 */
function withDerivedMetrics(output: VariantOutput): VariantOutput {
	for (const run of output.runs) {
		const median = run.report.metrics?.["scenario.interaction"]?.p50;
		if (Number.isFinite(median))
			run.metrics.interactionP50Ms = median as number;
	}
	return output;
}

interface ScenarioState {
	test: string;
	/** Why the scenario has no base comparison. */
	headOnly?: string;
	node: boolean;
	/** Base failures so far; a second one makes the scenario head-only. */
	baseFailures: number;
	pairs: Pair[];
	/** Every head sample, for the head budget checks. */
	head: Record<string, number>[];
	judgement?: ScenarioJudgement;
}

function listTests(args: string[], env: NodeJS.ProcessEnv): string[] {
	const list = spawnSync(
		pnpm,
		[
			"exec",
			"playwright",
			"test",
			"--config",
			config,
			...args,
			"--list",
			"--reporter=json",
		],
		{ encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 },
	);
	if (list.status !== 0)
		throw new Error(`Listing the scenarios failed:\n${list.stderr}`);
	interface Suite {
		specs?: { title: string }[];
		suites?: Suite[];
	}
	const report: { suites: Suite[] } = JSON.parse(
		list.stdout.slice(list.stdout.indexOf("{")),
	);
	const titles = new Set<string>();
	const visit = (suite: Suite) => {
		for (const spec of suite.specs ?? []) titles.add(spec.title);
		for (const child of suite.suites ?? []) visit(child);
	};
	for (const suite of report.suites) visit(suite);
	return [...titles];
}

async function startServer(
	directory: string,
	port: number,
	log: string,
	record: ServerRecord,
): Promise<ChildProcess> {
	// A server left on the port would answer the readiness check while ours
	// exits on --strictPort, and the run would measure another build.
	if (!(await portAvailable(port)))
		throw new Error(
			`Port ${port} is already in use, so the preview server for ${directory} cannot start there. Stop whatever listens on it, or set ECAD_PERF_PORT and ECAD_PERF_BASE_PORT to free ports.`,
		);
	const output = openSync(log, "w");
	const server = spawn(
		pnpm,
		[
			"run",
			"preview",
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
			"--strictPort",
		],
		{ cwd: directory, detached: true, stdio: ["ignore", output, output] },
	);
	if (server.pid) record.add(server.pid, port);
	const url = `http://127.0.0.1:${port}/projects`;
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (server.exitCode !== null)
			throw new Error(
				`The preview server for ${directory} exited (${server.exitCode}). Is port ${port} in use? Set ECAD_PERF_PORT and ECAD_PERF_BASE_PORT. See ${log}.`,
			);
		const ok = await fetch(url).then(
			(response) => response.ok,
			() => false,
		);
		if (ok) {
			if (server.exitCode !== null)
				throw new Error(
					`The preview server for ${directory} exited (${server.exitCode}), but something else answered on port ${port}. See ${log}.`,
				);
			return server;
		}
		await new Promise((done) => setTimeout(done, 250));
	}
	throw new Error(`The preview server at ${url} did not start. See ${log}.`);
}

function stop(server: ChildProcess | undefined) {
	if (!server?.pid || server.exitCode !== null) return;
	try {
		process.kill(-server.pid, "SIGTERM");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

const seconds = (ms: number) =>
	ms >= 60_000
		? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
		: `${(ms / 1000).toFixed(1)} s`;

/**
 * Interleaved A/B: rounds alternate the variant order (base then head, then
 * head then base), and only undecided scenarios run another round.
 */
async function compare(plan: Plan): Promise<number> {
	const base = plan.base;
	if (!base) throw new Error("The A/B plan has no base build.");
	touch(base.directory);
	const decision = decisionFromEnv(process.env);
	const options = decision.options;
	const cpu = String(decision.cpu);
	const headPort = Number(process.env.ECAD_PERF_PORT ?? 4175);
	const basePort = Number(process.env.ECAD_PERF_BASE_PORT ?? headPort + 1);
	const directory = resolve("perf-artifacts/ab");
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory, { recursive: true });
	const revision =
		process.env.ECAD_REVISION ??
		spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
	const dirty =
		!process.env.ECAD_REVISION &&
		Boolean(
			spawnSync("git", ["status", "--porcelain"], {
				encoding: "utf8",
			}).stdout.trim(),
		);
	const failures: string[] = [];
	const warnings: string[] = [];
	const states = new Map<string, ScenarioState>();
	const servers: ChildProcess[] = [];
	const record = new ServerRecord(
		resolve("perf-artifacts/preview-servers.json"),
	);
	const cleanup = () => {
		for (const server of servers) stop(server);
		record.clear();
	};
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
		process.once(signal, () => {
			cleanup();
			process.exit(130);
		});
	const variants = {
		head: { url: `http://127.0.0.1:${headPort}`, revision, env: {} },
		base: {
			url: `http://127.0.0.1:${basePort}`,
			revision: base.sha,
			env: {
				ECAD_CLI_EXECUTABLE: join(base.directory, "packages/cli/bin/ecad.mjs"),
			},
		},
	};
	const environment = (variant: "base" | "head") => ({
		...process.env,
		ECAD_PERF_MODE: "production",
		ECAD_PERF_CPU: cpu,
		ECAD_PERF_RUNS: "1",
		ECAD_PERF_URL: variants[variant].url,
		ECAD_PERF_VARIANT: variant,
		ECAD_REVISION: variants[variant].revision,
		...variants[variant].env,
	});
	const rest = withoutGrep(plan.args);
	let rounds = 0;
	try {
		// A killed run of this checkout can leave its detached servers behind.
		const leftovers = record.stopLeftovers();
		if (leftovers.length) {
			console.log(
				`[perf] Stopped preview servers left by an earlier run on port${leftovers.length === 1 ? "" : "s"} ${leftovers.join(", ")}.`,
			);
			for (const port of leftovers)
				for (let wait = 0; wait < 40 && !(await portAvailable(port)); wait++)
					await new Promise((done) => setTimeout(done, 250));
		}
		// Track each server as soon as it starts, so cleanup stops the head
		// server when the base server fails.
		servers.push(
			await startServer(
				process.cwd(),
				headPort,
				join(directory, "server-head.log"),
				record,
			),
		);
		servers.push(
			await startServer(
				base.directory,
				basePort,
				join(directory, "server-base.log"),
				record,
			),
		);
		const titles = listTests(plan.args, environment("head"));
		if (!titles.length) {
			failures.push("No scenarios match the selection.");
		}
		console.log(
			`[perf] A/B: base ${base.sha.slice(0, 12)} on :${basePort} vs head ${revision.slice(0, 12)}${dirty ? " with uncommitted changes" : ""} on :${headPort}. ${titles.length} test${titles.length === 1 ? "" : "s"}, CPU throttle ${cpu}×, timing noise floors ×${options.floorScale}, up to ${options.maxPairs} pairs.`,
		);
		let pending = new Set(titles);
		const finished = new Set<string>();
		while (pending.size && rounds < maxRounds(options)) {
			rounds++;
			const order: ("base" | "head")[] =
				rounds % 2 ? ["base", "head"] : ["head", "base"];
			const outputs: Partial<Record<"base" | "head", VariantOutput>> = {};
			for (const variant of order) {
				const selected = [...pending].filter(
					(title) =>
						variant === "head" ||
						![...states.values()].some(
							(state) => state.test === title && state.headOnly,
						),
				);
				if (!selected.length) continue;
				const file = join(directory, `round-${rounds}-${variant}.json`);
				console.log(
					`[perf] Round ${rounds}: ${variant}, ${selected.length} test${selected.length === 1 ? "" : "s"}.`,
				);
				const status = await run(
					pnpm,
					[
						"exec",
						"playwright",
						"test",
						"--config",
						config,
						...rest,
						"--grep",
						grepForTitles(selected),
					],
					{ ...environment(variant), ECAD_PERF_AB_OUTPUT: file },
				);
				if (!existsSync(file)) {
					failures.push(
						`Round ${rounds} ${variant}: Playwright exited ${status} without a report.`,
					);
					pending = new Set();
					break;
				}
				outputs[variant] = withDerivedMetrics(
					JSON.parse(readFileSync(file, "utf8")),
				);
			}
			const head = outputs.head;
			const baseOutput = outputs.base;
			if (!head) break;
			if (head.tagFailures.length) failures.push(...head.tagFailures);
			for (const test of head.tests) {
				if (test.status === "skipped") finished.add(test.test);
				else if (test.status !== "passed") {
					failures.push(
						`${test.test}: head ${test.status}${test.error ? `: ${test.error}` : ""}`,
					);
					finished.add(test.test);
				} else if (!head.runs.some((run) => run.test === test.test)) {
					failures.push(
						`${test.test}: head passed without a performance report.`,
					);
					finished.add(test.test);
				}
			}
			for (const result of head.runs) {
				const state = states.get(result.scenario) ?? {
					test: result.test,
					node: result.report.environment.userAgent.startsWith("Node/"),
					baseFailures: 0,
					pairs: [],
					head: [],
				};
				states.set(result.scenario, state);
				state.head.push(result.metrics);
				if (state.headOnly) continue;
				if (state.node && !nodeVariantScenarios.has(result.scenario)) {
					state.headOnly = "Node scenario that measures the head source";
					continue;
				}
				const baseTest = baseOutput?.tests.find(
					(test) => test.test === result.test,
				);
				const baseResult = baseOutput?.runs.find(
					(run) => run.scenario === result.scenario,
				);
				const failed = baseTest && baseTest.status !== "passed";
				if (baseResult) {
					state.pairs.push({ base: baseResult.metrics, head: result.metrics });
				} else if (failed && state.baseFailures < 1) {
					// A base flake costs a round, not the comparison.
					state.baseFailures++;
					warnings.push(
						`${result.scenario}: base ${baseTest.status} in round ${rounds}${baseTest.error ? ` (${baseTest.error})` : ""}; it runs again.`,
					);
				} else if (failed || !state.pairs.length) {
					state.headOnly = failed
						? `base ${baseTest.status} twice${baseTest.error ? `: ${baseTest.error}` : ""}`
						: "base did not report it";
				} else
					warnings.push(
						`${result.scenario}: round ${rounds} has no base result; the pair was dropped.`,
					);
			}
			for (const state of states.values())
				if (!state.headOnly)
					state.judgement = judgeScenario(state.pairs, options);
			pending = new Set(
				[...states.values()]
					.filter(
						(state) =>
							!state.headOnly &&
							!finished.has(state.test) &&
							state.judgement?.verdict === "undecided",
					)
					.map((state) => state.test),
			);
			const decided = [...states.values()].filter(
				(state) => state.headOnly || state.judgement?.verdict !== "undecided",
			).length;
			console.log(
				`[perf] After round ${rounds}: ${decided} of ${states.size} scenarios decided${pending.size ? `; ${pending.size} test${pending.size === 1 ? "" : "s"} run again` : ""}.`,
			);
		}
	} catch (error) {
		failures.push(error instanceof Error ? error.message : String(error));
	} finally {
		cleanup();
	}

	// Head checks that do not depend on timing: required measurements, DOM
	// nodes and script size. Node scenarios without a base also keep their
	// timing budgets, since they always run unthrottled.
	const summary = (filter: (state: ScenarioState) => boolean): Summary => ({
		version: 1,
		profile: {
			mode: "production",
			cpu: Number(cpu),
			platform: process.platform,
			browser: "",
		},
		scenarios: Object.fromEntries(
			[...states]
				.filter(([, state]) => filter(state))
				.map(([scenario, state]) => {
					const names = new Set(
						state.head.flatMap((metrics) => Object.keys(metrics)),
					);
					return [
						scenario,
						Object.fromEntries(
							[...names].map((name) => {
								const values = state.head
									.map((metrics) => metrics[name])
									.filter((value) => Number.isFinite(value))
									.sort((a, b) => a - b);
								return [
									name,
									{
										median: values[Math.floor(values.length / 2)],
										p95: values[
											Math.max(0, Math.ceil(values.length * 0.95) - 1)
										],
										samples: values.length,
									},
								];
							}),
						),
					];
				}),
		),
	});
	const nodeHeadOnly = (state: ScenarioState) =>
		state.node && Boolean(state.headOnly);
	failures.push(
		...checkBudgets(
			summary((state) => !nodeHeadOnly(state)),
			true,
		),
		...checkBudgets(summary(nodeHeadOnly), false),
	);
	const regressions = [...states].filter(
		([, state]) => state.judgement?.verdict === "regression" && !state.headOnly,
	);
	for (const [scenario, state] of regressions) {
		const worst = state.judgement?.worst;
		if (worst)
			failures.push(
				`${scenario}.${worst.metric}: head/base ×${worst.ratio.toFixed(2)} exceeds the limit ×${worst.threshold.toFixed(2)} over ${worst.pairs} pairs.`,
			);
	}
	for (const [scenario, state] of states)
		if (state.headOnly)
			warnings.push(`${scenario}: no base comparison (${state.headOnly}).`);
		else if (state.judgement?.verdict === "undecided")
			warnings.push(
				`${scenario}: undecided after ${state.pairs.length} pair${state.pairs.length === 1 ? "" : "s"}.`,
			);

	const finishedAt = Date.now();
	const durations = {
		totalMs: finishedAt - plan.started,
		buildMs: (plan.built ?? locked) - plan.started,
		baseBuildMs: base.built ? base.durationMs : 0,
		lockWaitMs: locked - (plan.built ?? locked),
		measureMs: finishedAt - locked,
	};
	const verdicts = [...states.values()].map((state) =>
		state.headOnly ? "head-only" : (state.judgement?.verdict ?? "undecided"),
	);
	const count = (verdict: string) =>
		verdicts.filter((value) => value === verdict).length;
	// Scenarios without a verdict were measured but not compared; say so as
	// loudly as the verdicts.
	const counts = {
		scenarios: states.size,
		compared: count("pass") + count("regression"),
		pass: count("pass"),
		regression: count("regression"),
		headOnly: count("head-only"),
		undecided: count("undecided"),
	};
	const artifact = {
		version: 2,
		kind: "ab",
		timestamp: new Date().toISOString(),
		status: failures.length ? "failed" : "passed",
		profile: {
			mode: "production",
			cpu: Number(cpu),
			platform: process.platform,
			cpus: cpus().length,
			loadAverage: loadavg().map((value) => Number(value.toFixed(2))),
			...(process.env.ECAD_PERF_ENVIRONMENT
				? { environment: process.env.ECAD_PERF_ENVIRONMENT }
				: {}),
		},
		base: { ref: base.ref, sha: base.sha, cached: !base.built },
		head: { revision, dirty },
		decision: options,
		rounds,
		counts,
		durations,
		failures,
		warnings,
		scenarios: Object.fromEntries(
			[...states].map(([scenario, state]) => [
				scenario,
				{
					test: state.test,
					verdict: state.headOnly
						? "head-only"
						: (state.judgement?.verdict ?? "undecided"),
					...(state.headOnly ? { reason: state.headOnly } : {}),
					pairs: state.pairs.length,
					...(state.judgement
						? {
								worst: state.judgement.worst?.metric,
								metrics: Object.fromEntries(
									state.judgement.metrics.map(({ metric, ...rest }) => [
										metric,
										rest,
									]),
								),
							}
						: { head: state.head }),
				},
			]),
		),
	};
	const artifacts = resolve("perf-artifacts");
	writeFileSync(
		join(artifacts, "latest.json"),
		JSON.stringify(artifact, null, 2),
	);
	writeFileSync(
		join(artifacts, `run-${Date.now()}.json`),
		JSON.stringify(artifact, null, 2),
	);
	for (const old of readdirSync(artifacts)
		.filter((name) => /^run-\d+\.json$/.test(name))
		.sort()
		.reverse()
		.slice(20))
		unlinkSync(join(artifacts, old));

	const order = ["regression", "undecided", "head-only", "pass"];
	for (const [scenario, state] of [...states].sort(
		([a, left], [b, right]) =>
			order.indexOf(
				left.headOnly ? "head-only" : (left.judgement?.verdict ?? ""),
			) -
				order.indexOf(
					right.headOnly ? "head-only" : (right.judgement?.verdict ?? ""),
				) || a.localeCompare(b),
	))
		console.log(
			`[perf] ${
				state.headOnly
					? `${"head-only".padEnd(10)} ${scenario.padEnd(28)} ${state.headOnly}`
					: state.judgement
						? describeJudgement(scenario, state.judgement)
						: scenario
			}`,
		);
	console.log(
		`[perf] ${counts.compared} of ${counts.scenarios} scenarios compared, ${counts.headOnly} head-only, ${counts.undecided} undecided. Verdicts: ${counts.pass} pass, ${counts.regression} regression. ${rounds} round${rounds === 1 ? "" : "s"}. Total ${seconds(durations.totalMs)} (builds ${seconds(durations.buildMs)}, lock wait ${seconds(durations.lockWaitMs)}, measurement ${seconds(durations.measureMs)}).`,
	);
	console.log("[perf] Report: perf-artifacts/latest.json");
	for (const warning of warnings) console.warn(`[perf] Warning: ${warning}`);
	for (const failure of failures) console.error(`[perf] ${failure}`);
	const undecided = [...states]
		.filter(
			([, state]) =>
				!state.headOnly && state.judgement?.verdict === "undecided",
		)
		.map(
			([scenario, state]) =>
				`${scenario} (${state.pairs.length} pair${state.pairs.length === 1 ? "" : "s"})`,
		);
	if (undecided.length)
		console.warn(
			`[perf] UNDECIDED, not compared: ${undecided.join(", ")}. These have no verdict; rerun them with --grep before reporting.`,
		);
	return failures.length ? 1 : 0;
}

process.exitCode = await (planned.mode === "ab"
	? compare(planned)
	: single(planned));
