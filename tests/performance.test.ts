import assert from "node:assert/strict";
import { test } from "node:test";
import { PerformanceRecorder } from "#/performance/recorder.ts";
import { budgets } from "./performance/budgets.ts";
import {
	checkBudgets,
	compareBaseline,
	type Summary,
} from "./performance/comparison.ts";

test("performance measurements preserve results, errors, and cancellation", async () => {
	let clock = 0;
	const recorder = new PerformanceRecorder(() => clock);
	assert.equal(
		recorder.measure("sync", () => {
			clock = 5;
			return 42;
		}),
		42,
	);
	assert.equal(
		await recorder.measureAsync("async", async () => {
			clock = 12;
			return 7;
		}),
		7,
	);
	const error = new Error("failed");
	assert.throws(
		() =>
			recorder.measure("sync-error", () => {
				throw error;
			}),
		(value) => value === error,
	);
	await assert.rejects(
		recorder.measureAsync("async-error", async () => {
			throw error;
		}),
		(value) => value === error,
	);
	const abort = new DOMException("aborted", "AbortError");
	await assert.rejects(
		recorder.measureAsync("abort", async () => {
			throw abort;
		}),
		(value) => value === abort,
	);
	const report = recorder.snapshot();
	assert.equal(report.metrics.sync.total, 5);
	assert.equal(report.metrics.async.total, 7);
	assert.equal(report.metrics["sync-error"].errors, 1);
	assert.equal(report.metrics["async-error"].errors, 1);
	assert.equal(report.metrics.abort.errors, 0);
	assert.equal(report.events.at(-1)?.status, "cancelled");
});

test("performance baseline comparison rejects regressions, missing metrics, and different environments", () => {
	const baseline: Summary = {
		version: 1,
		profile: {
			mode: "production",
			cpu: 4,
			platform: "linux",
			browser: "Chromium",
		},
		scenarios: {
			"projects-empty": { startupMs: { median: 400, p95: 420, samples: 3 } },
		},
	};
	const current = structuredClone(baseline);
	assert.deepEqual(compareBaseline(baseline, current), []);
	current.scenarios["projects-empty"].startupMs.median = 600;
	assert.deepEqual(compareBaseline(baseline, current), []);
	current.scenarios["projects-empty"].startupMs.median = 601;
	assert.match(compareBaseline(baseline, current)[0], /\b600\.0\b/);
	delete current.scenarios["projects-empty"].startupMs;
	assert.match(
		compareBaseline(baseline, current)[0],
		/^projects-empty\.startupMs\b/,
	);
	current.profile.cpu = 1;
	assert.match(compareBaseline(baseline, current)[0], /profile differs/);
	const focused = structuredClone(baseline);
	focused.scenarios = {};
	assert.deepEqual(compareBaseline(baseline, focused), []);
	const sampled = structuredClone(baseline);
	sampled.scenarios["projects-empty"].eventLoopP95Ms = {
		median: 100,
		p95: 120,
		samples: 3,
	};
	const noisy = structuredClone(sampled);
	noisy.scenarios["projects-empty"].eventLoopP95Ms.median = 225;
	assert.deepEqual(compareBaseline(sampled, noisy), []);
	noisy.scenarios["projects-empty"].eventLoopP95Ms.median = 226;
	assert.match(compareBaseline(sampled, noisy)[0], /\b225\.0\b/);
});

test("absolute performance budgets use repeated-run medians and reject sustained or single-run regressions", () => {
	const summary: Summary = {
		version: 1,
		profile: {
			mode: "production",
			cpu: 4,
			platform: "linux",
			browser: "Chromium",
		},
		scenarios: {
			"projects-empty": Object.fromEntries(
				Object.keys(budgets["projects-empty"]).map((name) => [
					name,
					{ median: 0, p95: 0, samples: 3 },
				]),
			),
		},
	};
	const loop = summary.scenarios["projects-empty"].eventLoopP95Ms;
	loop.median = budgets["projects-empty"].eventLoopP95Ms;
	loop.p95 = 1500;
	assert.deepEqual(checkBudgets(summary), []);
	loop.median++;
	assert.match(checkBudgets(summary)[0], /\b301\.0\b.*\b300\b/);
	loop.samples = 1;
	assert.equal(checkBudgets(summary).length, 1);
	summary.profile.mode = "development";
	assert.deepEqual(checkBudgets(summary), []);
	summary.scenarios["projects-empty"].domNodes.median = 1001;
	assert.match(checkBudgets(summary)[0], /\.domNodes\b/);
});
