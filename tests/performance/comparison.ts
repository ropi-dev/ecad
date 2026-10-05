import { regressionFloors } from "./budgets.ts";

export interface Summary {
	version: number;
	profile: { mode: string; cpu: number; platform: string; browser: string };
	scenarios: Record<
		string,
		Record<string, { median: number; p95: number; samples: number }>
	>;
}

export function compareBaseline(baseline: Summary, current: Summary): string[] {
	if (
		baseline.version !== current.version ||
		(Object.keys(current.profile) as (keyof Summary["profile"])[]).some(
			(key) => baseline.profile[key] !== current.profile[key],
		)
	)
		return [
			"Baseline profile differs. Use the same mode, CPU throttle, platform and browser, or explicitly capture a new baseline.",
		];
	const failures: string[] = [];
	for (const [scenario, metrics] of Object.entries(current.scenarios)) {
		for (const metric of Object.keys(baseline.scenarios[scenario] ?? {})) {
			if (!metrics[metric])
				failures.push(
					`${scenario}.${metric}: baseline metric is missing from the current report.`,
				);
		}
		for (const [metric, value] of Object.entries(metrics)) {
			const previous = baseline.scenarios[scenario]?.[metric];
			if (!previous) continue;
			const limit = previous.median * 1.25 + (regressionFloors[metric] ?? 50);
			if (value.median > limit)
				failures.push(
					`${scenario}.${metric}: ${value.median.toFixed(1)} exceeds baseline limit ${limit.toFixed(1)} (was ${previous.median.toFixed(1)}).`,
				);
		}
	}
	return failures;
}
