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
