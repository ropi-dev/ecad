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

let started: AppPerformance | undefined;

/**
 * Starts the recorder for the debug stats window when the build or page left
 * it off, so production builds collect only while the window is open.
 * `?perf=0` keeps it off. The returned function stops a recorder started
 * here.
 */
export function acquirePerformance(): () => void {
	if (typeof window === "undefined" || window.__ecadPerformance) return noop;
	if (new URLSearchParams(location.search).get("perf") === "0") return noop;
	const recorder = createBrowserPerformance(import.meta.env?.DEV ?? false);
	window.__ecadPerformance = recorder;
	started = recorder;
	return () => {
		if (started !== recorder) return;
		started = undefined;
		recorder.stop();
		if (window.__ecadPerformance === recorder) delete window.__ecadPerformance;
	};
}

const noop = () => {};
