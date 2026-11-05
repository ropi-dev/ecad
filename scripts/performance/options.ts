/**
 * How a perf command runs:
 * - `ab` (`pnpm run perf`): affected scenarios, base and head interleaved in
 *   one session, unthrottled.
 * - `budgets` (`pnpm run perf:budgets`): every scenario once, 4× throttled,
 *   against the absolute budgets.
 * - `smoke` (`ECAD_PERF_SMOKE=1`): every scenario once, functional checks only.
 * - `development` (`pnpm run perf:dev`): React profiling against a stored
 *   development baseline.
 * - `deprecated-baseline` (`pnpm run perf:baseline`): prints that it is no
 *   longer needed.
 */
export type Mode =
	| "ab"
	| "budgets"
	| "smoke"
	| "development"
	| "deprecated-baseline";

export interface ParsedRun {
	mode: Mode;
	/** Arguments for Playwright and the scenario selection. */
	args: string[];
	/** Whether the arguments contain an explicit `--grep`. */
	grep: boolean;
	/** The ref whose merge base with HEAD is the A/B base. */
	baseRef: string;
	updateBaseline: boolean;
}

export interface Plan {
	mode: Mode;
	args: string[];
	updateBaseline?: boolean;
	started: number;
	built?: number;
	base?: {
		ref: string;
		sha: string;
		directory: string;
		built: boolean;
		durationMs: number;
	};
}

export const explicitGrep = (arg: string) =>
	arg === "--grep" || arg === "-g" || arg.startsWith("--grep=");

/** Removes `--grep`/`-g` and their values, keeping `--grep-invert`. */
export function withoutGrep(args: readonly string[]): string[] {
	const result: string[] = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--grep" || arg === "-g") index++;
		else if (!arg.startsWith("--grep=")) result.push(arg);
	}
	return result;
}

export function parseRun(
	argv: readonly string[],
	env: NodeJS.ProcessEnv,
): ParsedRun {
	const args: string[] = [];
	let baseRef = env.ECAD_PERF_BASE ?? "origin/main";
	let development = false;
	let baseline = false;
	let budgets = false;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--development") development = true;
		else if (arg === "--baseline") baseline = true;
		else if (arg === "--budgets") budgets = true;
		else if (arg === "--base") {
			const value = argv[++index];
			if (!value) throw new Error("--base needs a Git ref.");
			baseRef = value;
		} else if (arg.startsWith("--base=")) baseRef = arg.slice(7);
		else args.push(arg);
	}
	const mode: Mode = development
		? "development"
		: env.ECAD_PERF_SMOKE === "1"
			? "smoke"
			: baseline
				? "deprecated-baseline"
				: budgets
					? "budgets"
					: "ab";
	return {
		mode,
		args: mode === "budgets" ? args.filter((arg) => arg !== "--all") : args,
		grep: args.some(explicitGrep),
		baseRef,
		updateBaseline: baseline,
	};
}
