import { regressionFloors } from "../../tests/performance/budgets.ts";

/**
 * Decisions for interleaved base/head (A/B) runs. Each round measures every
 * undecided scenario once per variant, so round `n` adds one pair. A metric's
 * verdict compares each pair against the regression limit the baseline
 * comparison has always used: `base × 1.25 + floor`, where the floor is the
 * metric's noise allowance from `regressionFloors`.
 */
export const regressionRatio = 1.25;
const defaultFloor = 50;

export interface DecisionOptions {
	/** Pairs after which every metric gets a final verdict. */
	maxPairs: number;
	/**
	 * A regression needs this many pairs. Interaction p95 over a handful of
	 * interactions is close to their maximum, so one slow interaction in two
	 * of three runs failed identical code; regressions wait for all pairs.
	 */
	minRegressionPairs: number;
	/**
	 * How far the score must sit from the limit to stop early, at one pair.
	 * The band shrinks with the square root of the number of pairs.
	 */
	margin: number;
	/**
	 * Multiplies the noise floors of timing (`…Ms`) metrics. The floors are
	 * absolute milliseconds calibrated under 4× CPU throttling, so runs use
	 * `throttle / 4` (see `floorScaleFor`).
	 */
	floorScale: number;
}

export const defaultDecision: DecisionOptions = {
	maxPairs: 5,
	minRegressionPairs: 5,
	margin: 0.2,
	floorScale: 1,
};

export type Verdict = "pass" | "regression" | "undecided";

export interface MetricJudgement {
	metric: string;
	verdict: Verdict;
	pairs: number;
	/** Median of the paired head / base ratios. */
	ratio: number;
	/** The ratio at the regression limit: 1.25 + floor / median base. */
	threshold: number;
	/** Median of head / (base × 1.25 + floor) across pairs; above 1 regresses. */
	score: number;
	base: number[];
	head: number[];
}

export interface ScenarioJudgement {
	verdict: Verdict;
	pairs: number;
	metrics: MetricJudgement[];
	/** The metric closest to, or furthest past, its limit. */
	worst?: MetricJudgement;
}

export function median(values: readonly number[]): number {
	if (!values.length) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The throttle the noise floors in `regressionFloors` were calibrated for. */
export const floorThrottle = 4;

/**
 * The floor scale for a CPU throttle. Unthrottled timings are several times
 * shorter than throttled ones, while a fixed floor stays the same, so at 1×
 * the 50 ms interaction floor alone allowed +40% to +150% on 40–500 ms
 * interactions and an injected 40% regression passed.
 */
export function floorScaleFor(cpu: number): number {
	return Math.min(1, cpu / floorThrottle);
}

/**
 * Event-loop p95 noise comes from the 250 ms sampling timer's alignment, not
 * from CPU speed, so its floor never scales.
 */
const unscaledFloors: ReadonlySet<string> = new Set(["eventLoopP95Ms"]);

export function floorFor(metric: string, options = defaultDecision): number {
	const floor = regressionFloors[metric] ?? defaultFloor;
	return metric.endsWith("Ms") && !unscaledFloors.has(metric)
		? floor * options.floorScale
		: floor;
}

/** Judges one metric from paired samples; `base[i]` and `head[i]` are a pair. */
export function judgeMetric(
	metric: string,
	base: readonly number[],
	head: readonly number[],
	options = defaultDecision,
	/**
	 * The scenario has all its pairs, so a metric missing from some of them
	 * gets a final verdict with fewer.
	 */
	final = false,
): MetricJudgement {
	if (base.length !== head.length)
		throw new Error(`${metric}: ${base.length} base and ${head.length} head`);
	const floor = floorFor(metric, options);
	const pairs = base.length;
	const score = median(
		base.map((value, index) => head[index] / (value * regressionRatio + floor)),
	);
	const ratio = median(
		base.map((value, index) =>
			value > 0 ? head[index] / value : head[index] > 0 ? Infinity : 1,
		),
	);
	const baseMedian = median(base);
	const threshold =
		baseMedian > 0 ? regressionRatio + floor / baseMedian : Infinity;
	const band = options.margin / Math.sqrt(Math.max(pairs, 1));
	// A regression always needs this many of the metric's own pairs, so a
	// metric reported in one pair cannot fail a scenario alone.
	const needed = Math.min(options.minRegressionPairs, options.maxPairs);
	const verdict: Verdict = !pairs
		? "undecided"
		: final || pairs >= options.maxPairs
			? score <= 1
				? "pass"
				: pairs >= needed
					? "regression"
					: "undecided"
			: score <= 1 - band
				? "pass"
				: score >= 1 + band && pairs >= needed
					? "regression"
					: "undecided";
	return {
		metric,
		verdict,
		pairs,
		ratio,
		threshold,
		score,
		base: [...base],
		head: [...head],
	};
}

/**
 * Reported but not part of a scenario's verdict. Event-loop p95 comes from a
 * 250 ms sampling timer, and its alignment makes it bimodal: identical builds
 * measured 10 ms and 600 ms. Blocking time and frame metrics still catch
 * main-thread stalls.
 */
export const advisoryMetrics: ReadonlySet<string> = new Set(["eventLoopP95Ms"]);

/**
 * Rounds an A/B run may take. A round can lose a pair, for example when the
 * base fails once, so one spare round lets every compared scenario still
 * reach `maxPairs` pairs.
 */
export function maxRounds(options = defaultDecision): number {
	return options.maxPairs + 1;
}

export interface Pair {
	base: Record<string, number>;
	head: Record<string, number>;
}

/**
 * Judges a scenario from its pairs. Every finite metric both variants report
 * is compared. One regressed metric decides the scenario; a pass needs every
 * metric to pass. Advisory metrics are judged and reported but do not count.
 */
export function judgeScenario(
	pairs: readonly Pair[],
	options = defaultDecision,
): ScenarioJudgement {
	const names = new Set(
		pairs.flatMap((pair) =>
			Object.keys(pair.head).filter(
				(name) =>
					Number.isFinite(pair.head[name]) && Number.isFinite(pair.base[name]),
			),
		),
	);
	const metrics = [...names].sort().map((name) => {
		const usable = pairs.filter(
			(pair) =>
				Number.isFinite(pair.head[name]) && Number.isFinite(pair.base[name]),
		);
		return judgeMetric(
			name,
			usable.map((pair) => pair.base[name]),
			usable.map((pair) => pair.head[name]),
			options,
			pairs.length >= options.maxPairs,
		);
	});
	const deciding = metrics.filter(
		(metric) => !advisoryMetrics.has(metric.metric),
	);
	const worst = deciding.reduce<MetricJudgement | undefined>(
		(current, metric) =>
			!current || metric.score > current.score ? metric : current,
		undefined,
	);
	const verdict: Verdict = !pairs.length
		? "undecided"
		: deciding.some((metric) => metric.verdict === "regression")
			? "regression"
			: deciding.every((metric) => metric.verdict === "pass")
				? "pass"
				: "undecided";
	return { verdict, pairs: pairs.length, metrics, worst };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A `--grep` pattern for exact test titles. Playwright matches it against the
 * file, describe and test titles joined by spaces, followed by the tags, so a
 * title must be delimited by whitespace or the ends.
 */
export function grepForTitles(titles: Iterable<string>): string {
	return `(?:^|\\s)(?:${[...new Set(titles)].sort().map(escapeRegExp).join("|")})(?:\\s|$)`;
}

const format = (value: number) =>
	Number.isFinite(value) ? `×${value.toFixed(2)}` : "×∞";

/** One line per scenario for the console summary. */
export function describeJudgement(
	scenario: string,
	judgement: ScenarioJudgement,
): string {
	const worst = judgement.worst;
	return `${judgement.verdict.padEnd(10)} ${scenario.padEnd(28)} ${
		worst
			? `${worst.metric} ${format(worst.ratio)} (limit ${format(worst.threshold)}, score ${worst.score.toFixed(2)})`
			: "no shared metrics"
	}, ${judgement.pairs} pair${judgement.pairs === 1 ? "" : "s"}`;
}

/**
 * Node scenarios that measure a build the base checkout provides. The base
 * variant of `cli-drawing` runs the base commit's built CLI through
 * `ECAD_CLI_EXECUTABLE`. Other Node scenarios import the head checkout's
 * source directly, so they run head-only against their budgets.
 */
export const nodeVariantScenarios: ReadonlySet<string> = new Set([
	"cli-drawing",
]);

/**
 * The CPU throttle and decision options for an A/B run, from
 * `ECAD_PERF_CPU`, `ECAD_PERF_MAX_PAIRS` and `ECAD_PERF_FLOOR_SCALE`. Invalid
 * values throw instead of silently measuring nothing or scoring `NaN`.
 */
export function decisionFromEnv(env: NodeJS.ProcessEnv): {
	cpu: number;
	options: DecisionOptions;
} {
	const read = (
		name: string,
		fallback: number,
		valid: (value: number) => boolean,
		expected: string,
	) => {
		const raw = env[name];
		if (raw === undefined || raw.trim() === "") return fallback;
		const value = Number(raw);
		if (!valid(value))
			throw new Error(`${name} must be ${expected}, not "${raw}".`);
		return value;
	};
	const cpu = read(
		"ECAD_PERF_CPU",
		1,
		(value) => Number.isFinite(value) && value >= 1,
		"a number of at least 1",
	);
	return {
		cpu,
		options: {
			...defaultDecision,
			maxPairs: read(
				"ECAD_PERF_MAX_PAIRS",
				defaultDecision.maxPairs,
				(value) => Number.isInteger(value) && value >= 1,
				"a positive integer",
			),
			floorScale: read(
				"ECAD_PERF_FLOOR_SCALE",
				floorScaleFor(cpu),
				(value) => Number.isFinite(value) && value >= 0,
				"a finite number of at least 0",
			),
		},
	};
}
