import assert from "node:assert/strict";
import { test } from "node:test";
import {
	defaultDecision,
	floorFor,
	judgeMetric,
	judgeScenario,
} from "../scripts/performance/ab.ts";
import { parseRun, withoutGrep } from "../scripts/performance/options.ts";

const repeat = (value: number, count: number) =>
	Array.from({ length: count }, () => value);

test("the limit is the baseline rule: 25% plus the metric's noise floor", () => {
	// interactionP95Ms has a 50 ms floor: limit = 200 × 1.25 + 50 = 300 ms.
	const atLimit = judgeMetric("interactionP95Ms", [200], [300]);
	assert.equal(atLimit.ratio, 1.5);
	assert.equal(atLimit.threshold, 1.5);
	assert.equal(atLimit.score, 1);
	// Unknown metrics use a 50 floor; timing floors scale, others do not.
	assert.equal(floorFor("someNewMs"), 50);
	assert.equal(
		floorFor("interactionP95Ms", { ...defaultDecision, floorScale: 0.25 }),
		12.5,
	);
	assert.equal(
		floorFor("domNodes", { ...defaultDecision, floorScale: 0.25 }),
		50,
	);
});

test("one clearly fast pair passes; a borderline pair stays undecided", () => {
	// Score 220 / 300 = 0.73, below 1 - 0.2.
	assert.equal(judgeMetric("interactionP95Ms", [200], [220]).verdict, "pass");
	// Score 0.9 is within the one-pair band.
	assert.equal(
		judgeMetric("interactionP95Ms", [200], [270]).verdict,
		"undecided",
	);
});

test("a regression needs all five pairs, however large the first ones are", () => {
	for (const pairs of [1, 2, 3, 4])
		assert.equal(
			judgeMetric("interactionP95Ms", repeat(200, pairs), repeat(600, pairs))
				.verdict,
			"undecided",
		);
	const five = judgeMetric("interactionP95Ms", repeat(200, 5), repeat(600, 5));
	assert.equal(five.verdict, "regression");
	assert.equal(five.ratio, 3);
	// With an earlier minimum, a clear regression stops early.
	assert.equal(
		judgeMetric("interactionP95Ms", repeat(200, 3), repeat(600, 3), {
			...defaultDecision,
			minRegressionPairs: 3,
		}).verdict,
		"regression",
	);
});

test("a scenario regresses on any metric and passes only when all pass", () => {
	const pair = (base: number, head: number) => ({
		base: { interactionP95Ms: 200, domNodes: base },
		head: { interactionP95Ms: 200, domNodes: head },
	});
	assert.equal(judgeScenario([pair(1000, 1000)]).verdict, "pass");
	const grown = judgeScenario(repeat(0, 5).map(() => pair(1000, 2000)));
	assert.equal(grown.verdict, "regression");
	assert.equal(grown.worst?.metric, "domNodes");
	assert.equal(judgeScenario([pair(1000, 1200)]).verdict, "undecided");
	assert.equal(judgeScenario([]).verdict, "undecided");
});

test("perf commands parse into modes", () => {
	assert.equal(parseRun([], {}).mode, "ab");
	assert.equal(parseRun([], {}).baseRef, "origin/main");
	assert.equal(
		parseRun([], { ECAD_PERF_BASE: "upstream/main" }).baseRef,
		"upstream/main",
	);
	const based = parseRun(["--base", "abc123", "--all", "--workers=2"], {});
	assert.equal(based.baseRef, "abc123");
	assert.deepEqual(based.args, ["--all", "--workers=2"]);
	assert.equal(parseRun(["--base=v1"], {}).baseRef, "v1");
	assert.throws(() => parseRun(["--base"], {}), /--base/);
	assert.equal(parseRun(["--budgets", "--all"], {}).mode, "budgets");
	assert.deepEqual(parseRun(["--budgets", "--all"], {}).args, []);
	assert.equal(parseRun(["--baseline"], {}).mode, "deprecated-baseline");
	assert.equal(
		parseRun(["--development", "--baseline"], {}).mode,
		"development",
	);
	assert.equal(parseRun(["--all"], { ECAD_PERF_SMOKE: "1" }).mode, "smoke");
	assert.equal(parseRun(["-g", "x"], {}).grep, true);
	assert.deepEqual(
		withoutGrep([
			"--grep",
			"a",
			"-g",
			"b",
			"--grep=c",
			"--grep-invert",
			"d",
			"--workers=1",
		]),
		["--grep-invert", "d", "--workers=1"],
	);
});
