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
	/** A regression needs this many pairs, so one slow pair cannot fail a run. */
	minRegressionPairs: number;
	/**
	 * How far the score must sit from the limit to stop early, at one pair.
	 * The band shrinks with the square root of the number of pairs.
	 */
	margin: number;
	/**
	 * Multiplies the noise floors of timing (`…Ms`) metrics. The floors are
	 * absolute milliseconds calibrated under 4× CPU throttling.
	 */
	floorScale: number;
}

export const defaultDecision: DecisionOptions = {
	maxPairs: 5,
	minRegressionPairs: 3,
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

export function floorFor(metric: string, options = defaultDecision): number {
	const floor = regressionFloors[metric] ?? defaultFloor;
	return metric.endsWith("Ms") ? floor * options.floorScale : floor;
}

/** Judges one metric from paired samples; `base[i]` and `head[i]` are a pair. */
export function judgeMetric(
	metric: string,
	base: readonly number[],
	head: readonly number[],
	options = defaultDecision,
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
	const verdict: Verdict = !pairs
		? "undecided"
		: pairs >= options.maxPairs
			? score > 1
				? "regression"
				: "pass"
			: score <= 1 - band
				? "pass"
				: score >= 1 + band && pairs >= options.minRegressionPairs
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

export interface Pair {
	base: Record<string, number>;
	head: Record<string, number>;
}

/**
 * Judges a scenario from its pairs. Every finite metric both variants report
 * is compared. One regressed metric decides the scenario; a pass needs every
 * metric to pass.
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
			// A metric missing from some pairs still stops at the scenario's limit.
			pairs.length >= options.maxPairs
				? { ...options, maxPairs: usable.length }
				: options,
		);
	});
	const worst = metrics.reduce<MetricJudgement | undefined>(
		(current, metric) =>
			!current || metric.score > current.score ? metric : current,
		undefined,
	);
	const verdict: Verdict = !pairs.length
		? "undecided"
		: metrics.some((metric) => metric.verdict === "regression")
			? "regression"
			: metrics.every((metric) => metric.verdict === "pass")
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
