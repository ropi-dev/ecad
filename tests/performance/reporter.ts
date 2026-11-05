import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import {
	checkBudgets,
	compareBaseline,
	missingFromBaseline,
	profileBrowser,
	type Summary,
} from "./comparison.ts";
import { areas, isArea } from "./tags.ts";

interface Result {
	scenario: string;
	metrics: Record<string, number>;
	report: { mode: string; environment: { userAgent: string } };
}
/** Functional smoke runs, such as CI, skip timing budgets and baselines. */
const smoke = process.env.ECAD_PERF_SMOKE === "1";

export default class PerformanceReporter implements Reporter {
	private runs: Result[] = [];
	private failures: string[] = [];
	private warnings: string[] = [];
	onBegin(_config: FullConfig, suite: Suite) {
		const titles = new Set<string>();
		for (const test of suite.allTests()) {
			const unknown = test.tags.filter((tag) => !isArea(tag));
			if (!test.tags.some(isArea) || unknown.length) titles.add(test.title);
		}
		for (const title of titles) {
			const failure = `${title}: tag it with at least one of ${Object.keys(areas).join(", ")} and no other tags (see tests/performance/tags.ts).`;
			console.error(`[perf] ${failure}`);
			this.failures.push(failure);
		}
	}
	onTestEnd(test: TestCase, result: TestResult) {
		if (result.status !== "passed" && result.status !== "skipped")
			this.failures.push(`${test.title}: ${result.status}`);
		for (const attachment of result.attachments.filter(
			(item) => item.name === "performance",
		)) {
			const content =
				attachment.body?.toString("utf8") ??
				(attachment.path ? readFileSync(attachment.path, "utf8") : undefined);
			if (content) this.runs.push(JSON.parse(content));
		}
	}
	async onEnd(result: FullResult) {
		const directory = resolve("perf-artifacts");
		mkdirSync(directory, { recursive: true });
		const baselinePath = resolve(
			process.env.ECAD_PERF_BASELINE_PATH ?? "perf-artifacts/baseline.json",
		);
		const summary: Summary = {
			version: 1,
			profile: {
				mode: process.env.ECAD_PERF_MODE ?? "production",
				cpu: Number(process.env.ECAD_PERF_CPU ?? 4),
				platform: process.platform,
				browser: profileBrowser(this.runs),
				...(process.env.ECAD_PERF_ENVIRONMENT
					? { environment: process.env.ECAD_PERF_ENVIRONMENT }
					: {}),
			},
			scenarios: {},
		};
		for (const scenario of new Set(this.runs.map((run) => run.scenario))) {
			const runs = this.runs.filter((run) => run.scenario === scenario);
			const metrics = new Set(runs.flatMap((run) => Object.keys(run.metrics)));
			summary.scenarios[scenario] = {};
			for (const metric of metrics) {
				const values = runs
					.map((run) => run.metrics[metric])
					.filter((value) => Number.isFinite(value))
					.sort((a, b) => a - b);
				summary.scenarios[scenario][metric] = {
					median: values[Math.floor(values.length / 2)],
					p95: values[Math.max(0, Math.ceil(values.length * 0.95) - 1)],
					samples: values.length,
				};
			}
		}
		if (this.runs.length === 0)
			this.failures.push("No performance reports were captured.");
		this.failures.push(...checkBudgets(summary, smoke));
		if (
			!smoke &&
			process.env.ECAD_PERF_UPDATE_BASELINE !== "1" &&
			this.runs.length
		) {
			if (existsSync(baselinePath)) {
				const baseline: Summary = JSON.parse(
					readFileSync(baselinePath, "utf8"),
				);
				this.failures.push(...compareBaseline(baseline, summary));
				this.warnings.push(...missingFromBaseline(baseline, summary));
			} else
				this.warnings.push(
					`No baseline at ${process.env.ECAD_PERF_BASELINE_PATH ?? "perf-artifacts/baseline.json"}, so scenarios were checked against their budgets only. Run pnpm run perf:baseline before the change.`,
				);
		}
		let revision = "unknown";
		try {
			revision =
				process.env.ECAD_REVISION ??
				execFileSync("git", ["rev-parse", "HEAD"], {
					encoding: "utf8",
				}).trim();
		} catch {
			revision = "unknown";
		}
		const artifact = {
			...summary,
			timestamp: new Date().toISOString(),
			revision,
			status: this.failures.length ? "failed" : result.status,
			failures: this.failures,
			warnings: this.warnings,
			runs: this.runs,
		};
		writeFileSync(
			resolve(directory, "latest.json"),
			JSON.stringify(artifact, null, 2),
		);
		writeFileSync(
			resolve(directory, `run-${Date.now()}.json`),
			JSON.stringify(artifact, null, 2),
		);
		for (const old of readdirSync(directory)
			.filter((name) => /^run-\d+\.json$/.test(name))
			.sort()
			.reverse()
			.slice(20))
			unlinkSync(resolve(directory, old));
		if (
			!smoke &&
			process.env.ECAD_PERF_UPDATE_BASELINE === "1" &&
			result.status === "passed" &&
			!this.failures.length
		) {
			mkdirSync(dirname(baselinePath), { recursive: true });
			writeFileSync(baselinePath, JSON.stringify(summary, null, 2));
		}
		for (const [scenario, metrics] of Object.entries(summary.scenarios))
			console.log(
				`[perf] ${scenario}: ${Object.entries(metrics)
					.map(([name, value]) => `${name}=${value.median.toFixed(1)}`)
					.join(", ")}`,
			);
		console.log("[perf] Report: perf-artifacts/latest.json");
		for (const warning of this.warnings)
			console.warn(`[perf] Warning: ${warning}`);
		for (const failure of this.failures) console.error(`[perf] ${failure}`);
		if (this.failures.length) return { status: "failed" as const };
	}
}
