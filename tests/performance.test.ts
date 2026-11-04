import assert from "node:assert/strict";
import { test } from "node:test";
import { PerformanceRecorder } from "#/performance/recorder.ts";
import { required } from "./helpers/required.ts";
import { budgets } from "./performance/budgets.ts";
import {
	checkBudgets,
	compareBaseline,
	type Summary,
} from "./performance/comparison.ts";

test("performance records stay bounded while totals retain the whole session", () => {
	let clock = 100;
	const recorder = new PerformanceRecorder(() => clock, 3, 2, 2);
	for (const duration of [1, 2, 3, 4, 5]) {
		clock += duration;
		recorder.record("work", duration);
	}
	recorder.record("other", 1);
	recorder.record("over-limit", 1);
	const report = recorder.snapshot();
	assert.deepEqual(
		report.events.map((event) => event.duration),
		[4, 5, 1],
	);
	assert.deepEqual(report.metrics.work, {
		count: 5,
		errors: 0,
		total: 15,
		max: 5,
		p50: 4,
		p95: 5,
		sampleCount: 2,
	});
	assert.equal(report.metrics["over-limit"], undefined);
	assert.equal(Object.keys(report.metrics).length, 2);
});

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

test("performance snapshots are detached, timers finish once, and reset clears measurements", () => {
	let clock = 10;
	const recorder = new PerformanceRecorder(() => clock);
	const data = { count: 3 };
	const finish = recorder.start("operation", data);
	clock = 20;
	finish();
	finish("error");
	data.count = 99;
	const report = recorder.snapshot();
	assert.equal(report.metrics.operation.count, 1);
	assert.equal(report.events[0].data?.count, 3);
	required(report.events[0].data).count = 44;
	report.metrics.operation.total = 100;
	assert.equal(recorder.snapshot().events[0].data?.count, 3);
	assert.equal(recorder.snapshot().metrics.operation.total, 10);
	clock = 30;
	recorder.reset();
	assert.deepEqual(recorder.snapshot(), {
		startedAt: 30,
		capturedAt: 30,
		metrics: {},
		events: [],
	});
	recorder.record("invalid", NaN);
	recorder.record("invalid", -1);
	recorder.record("invalid", 1, undefined, Infinity);
	assert.deepEqual(recorder.snapshot().metrics, {});
	assert.throws(() => new PerformanceRecorder(() => 0, 0), /positive integers/);
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
	assert.match(
		compareBaseline(baseline, current)[0],
		/exceeds baseline limit 600/,
	);
	delete current.scenarios["projects-empty"].startupMs;
	assert.match(
		compareBaseline(baseline, current)[0],
		/missing from the current report/,
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
	assert.match(
		compareBaseline(sampled, noisy)[0],
		/exceeds baseline limit 225/,
	);
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
	assert.match(checkBudgets(summary)[0], /median 301.0 exceeds budget 300/);
	loop.samples = 1;
	assert.match(checkBudgets(summary)[0], /exceeds budget/);
	summary.profile.mode = "development";
	assert.deepEqual(checkBudgets(summary), []);
	summary.scenarios["projects-empty"].domNodes.median = 1001;
	assert.match(checkBudgets(summary)[0], /domNodes.*exceeds budget/);
});

test("absolute performance budgets reject missing or nonfinite measurements and unknown scenarios", () => {
	const summary: Summary = {
		version: 1,
		profile: {
			mode: "production",
			cpu: 4,
			platform: "linux",
			browser: "Chromium",
		},
		scenarios: { "projects-empty": {} },
	};
	assert.equal(
		checkBudgets(summary).length,
		Object.keys(budgets["projects-empty"]).length,
	);
	for (const invalid of [NaN, Infinity, -Infinity]) {
		summary.scenarios["projects-empty"].startupMs = {
			median: invalid,
			p95: invalid,
			samples: 1,
		};
		assert.match(checkBudgets(summary)[0], /startupMs.*missing or invalid/);
	}
	summary.scenarios = { unknown: {} };
	assert.match(checkBudgets(summary)[0], /no performance budgets are defined/);
});
