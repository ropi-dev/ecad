import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import type {
	Reporter,
	TestCase,
	TestResult,
	FullResult,
} from "@playwright/test/reporter";
import { checkBudgets, compareBaseline, type Summary } from "./comparison.ts";

interface Result {
	scenario: string;
	metrics: Record<string, number>;
	report: { mode: string; environment: { userAgent: string } };
}
export default class PerformanceReporter implements Reporter {
	private runs: Result[] = [];
	private failures: string[] = [];
	onTestEnd(test: TestCase, result: TestResult) {
		if (result.status !== "passed")
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
				browser: this.runs[0]?.report.environment.userAgent ?? "unavailable",
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
		this.failures.push(...checkBudgets(summary));
		if (
			process.env.ECAD_PERF_UPDATE_BASELINE !== "1" &&
			existsSync(baselinePath)
		) {
			const baseline: Summary = JSON.parse(readFileSync(baselinePath, "utf8"));
			this.failures.push(...compareBaseline(baseline, summary));
		}
		let revision = "unknown";
		try {
			revision = execFileSync("git", ["rev-parse", "HEAD"], {
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
			runs: this.runs,
		};
		writeFileSync(
			resolve(directory, "latest.json"),
			JSON.stringify(artifact, null, 2),
		);
		if (
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
		for (const failure of this.failures) console.error(`[perf] ${failure}`);
		if (this.failures.length) return { status: "failed" as const };
	}
}
