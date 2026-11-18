import {
	type AppPerformance,
	createBrowserPerformance,
} from "#/performance/browser.ts";

export {
	measurePerformance,
	measurePerformanceAsync,
} from "@ecad/drawing-core/performance/runtime.ts";

declare global {
	interface Window {
		__ecadPerformance?: AppPerformance;
	}
}

export function initializePerformance() {
	if (typeof window === "undefined" || window.__ecadPerformance) return;
	const query = new URLSearchParams(location.search).get("perf");
	let enabled = import.meta.env?.DEV ?? false;
	if (query !== null) enabled = query === "1";
	else if (!enabled) {
		try {
			enabled = localStorage.getItem("ecad.performance") === "1";
		} catch {
			enabled = false;
		}
	}
	if (enabled)
		window.__ecadPerformance = createBrowserPerformance(
			import.meta.env?.DEV ?? false,
		);
}

export const getAppPerformance = () =>
	typeof window === "undefined" ? undefined : window.__ecadPerformance;

let acquired: AppPerformance | undefined;
let holders = 0;

/**
 * Starts the recorder when the build or page left it off, for the debug stats
 * window and for telemetry, so production builds collect only while one of
 * them needs it. `?perf=0` keeps it off. The recorder stops when every
 * returned function has been called.
 */
export function acquirePerformance(): () => void {
	if (typeof window === "undefined") return noop;
	if (window.__ecadPerformance && window.__ecadPerformance !== acquired)
		return noop;
	if (new URLSearchParams(location.search).get("perf") === "0") return noop;
	if (!acquired) {
		acquired = createBrowserPerformance(import.meta.env?.DEV ?? false);
		window.__ecadPerformance = acquired;
	}
	const recorder = acquired;
	holders++;
	let released = false;
	return () => {
		if (released || acquired !== recorder) return;
		released = true;
		holders--;
		if (holders > 0) return;
		acquired = undefined;
		recorder.stop();
		if (window.__ecadPerformance === recorder) delete window.__ecadPerformance;
	};
}

const noop = () => {};
