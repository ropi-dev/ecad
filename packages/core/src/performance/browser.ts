import { PerformanceRecorder } from "#/performance/recorder.ts";

export function createBrowserPerformance(development: boolean) {
	const recorder = new PerformanceRecorder(
		() => performance.now(),
		512,
		120,
		128,
		(sample) => {
			if (
				sample.name.startsWith("browser.") ||
				sample.name === "renderer.frame" ||
				sample.name.startsWith("react.")
			)
				return;
			try {
				const name = `ecad.${sample.name}`;
				performance.measure(name, {
					start: sample.startTime,
					duration: sample.duration,
				});
				performance.clearMeasures(name);
			} catch {
				return;
			}
		},
	);
	const observers: {
		observer: PerformanceObserver;
		receive: (entries: PerformanceEntry[]) => void;
	}[] = [];
	const supported =
		typeof PerformanceObserver === "undefined"
			? []
			: PerformanceObserver.supportedEntryTypes;
	let cutoff = 0;
	let stopped = false;
	let navigation:
		| { path: string; finish: ReturnType<PerformanceRecorder["start"]> }
		| undefined;
	let currentPath = location.pathname;
	let ready = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const observe = (
		type: string,
		receive: (entries: PerformanceEntry[]) => void,
		options: PerformanceObserverInit & { durationThreshold?: number } = {},
	) => {
		if (!supported.includes(type)) return;
		try {
			const filtered = (entries: PerformanceEntry[]) =>
				receive(entries.filter((entry) => entry.startTime >= cutoff));
			const observer = new PerformanceObserver((list) =>
				filtered(list.getEntries()),
			);
			observer.observe({ type, buffered: true, ...options });
			observers.push({ observer, receive: filtered });
		} catch {
			return;
		}
	};
	observe("longtask", (entries) => {
		for (const entry of entries) {
			recorder.record(
				"browser.long-task",
				entry.duration,
				undefined,
				entry.startTime,
			);
			recorder.record(
				"browser.blocking-time",
				Math.max(0, entry.duration - 50),
				undefined,
				entry.startTime,
			);
		}
	});
	observe("paint", (entries) => {
		for (const entry of entries)
			recorder.record(`browser.${entry.name}`, entry.startTime, undefined, 0);
	});
	observe("largest-contentful-paint", (entries) => {
		const entry = entries.at(-1);
		if (entry) recorder.record("browser.lcp", entry.startTime, undefined, 0);
	});
	observe(
		"event",
		(entries) => {
			for (const entry of entries) {
				const event = entry as PerformanceEventTiming;
				recorder.record(
					"browser.input-delay",
					Math.max(0, event.processingStart - event.startTime),
					{ interactionId: event.interactionId ?? 0 },
					event.startTime,
				);
				recorder.record(
					"browser.event-duration",
					event.duration,
					undefined,
					event.startTime,
				);
			}
		},
		{ durationThreshold: 16 },
	);
	const flush = () => {
		for (const { observer, receive } of observers)
			receive(observer.takeRecords());
	};
	const sampleLoop = () => {
		clearTimeout(timer);
		if (stopped || document.visibilityState !== "visible") return;
		const start = performance.now();
		timer = setTimeout(() => {
			if (document.visibilityState === "visible")
				recorder.record(
					"browser.event-loop-delay",
					Math.max(0, performance.now() - start - 250),
				);
			sampleLoop();
		}, 250);
	};
	const onClick = (event: MouseEvent) => {
		if (
			event.button !== 0 ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			event.altKey ||
			!(event.target instanceof Element)
		)
			return;
		const anchor = event.target.closest("a");
		if (
			!anchor ||
			anchor.hasAttribute("download") ||
			(anchor.target && anchor.target !== "_self")
		)
			return;
		const target = new URL(anchor.href);
		if (target.origin !== location.origin || target.pathname === currentPath)
			return;
		navigation?.finish("cancelled");
		navigation = {
			path: target.pathname,
			finish: recorder.start("navigation.ready"),
		};
	};
	document.addEventListener("click", onClick, true);
	document.addEventListener("visibilitychange", sampleLoop);
	sampleLoop();
	const api = {
		record: recorder.record.bind(recorder),
		start: recorder.start.bind(recorder),
		measure: recorder.measure.bind(recorder),
		measureAsync: recorder.measureAsync.bind(recorder),
		appReady() {
			if (ready) return;
			ready = true;
			recorder.record("app.ready", performance.now(), undefined, 0);
		},
		workspaceReady(path: string) {
			currentPath = path;
			if (navigation?.path === path) {
				navigation.finish();
				navigation = undefined;
			}
		},
		reset() {
			flush();
			cutoff = performance.now();
			recorder.reset();
		},
		snapshot() {
			flush();
			const resources = performance.getEntriesByType(
				"resource",
			) as PerformanceResourceTiming[];
			const scripts = resources.filter(
				(entry) =>
					/\.(?:js|tsx?)(?:\?|$)/.test(entry.name) ||
					entry.initiatorType === "script",
			);
			const heap = (
				performance as Performance & { memory?: { usedJSHeapSize: number } }
			).memory?.usedJSHeapSize;
			const nav = performance.getEntriesByType("navigation")[0] as
				| PerformanceNavigationTiming
				| undefined;
			return {
				version: 1 as const,
				mode: development ? "development" : "production",
				environment: {
					userAgent: navigator.userAgent,
					viewport: [innerWidth, innerHeight],
					devicePixelRatio,
					hardwareConcurrency: navigator.hardwareConcurrency,
					visibility: document.visibilityState,
					supportedEntryTypes: [...supported],
					reactProfiler: development,
				},
				...recorder.snapshot(),
				heapBytes: heap ?? null,
				domNodes: document.getElementsByTagName("*").length,
				resources: {
					count: resources.length,
					scriptCount: scripts.length,
					scriptBytes: scripts.reduce(
						(sum, entry) => sum + entry.decodedBodySize,
						0,
					),
					largestScripts: [...scripts]
						.sort((a, b) => b.decodedBodySize - a.decodedBodySize)
						.slice(0, 15)
						.map((entry) => ({
							path: new URL(entry.name).pathname,
							bytes: entry.decodedBodySize,
							duration: entry.duration,
						})),
				},
				navigation: nav
					? {
							responseMs: nav.responseEnd,
							domContentLoadedMs: nav.domContentLoadedEventEnd,
							loadMs: nav.loadEventEnd,
						}
					: null,
			};
		},
		export() {
			return JSON.stringify(api.snapshot(), null, 2);
		},
		download() {
			const url = URL.createObjectURL(
				new Blob([api.export()], { type: "application/json" }),
			);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = "ecad-performance.json";
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 0);
		},
		stop() {
			stopped = true;
			clearTimeout(timer);
			flush();
			for (const { observer } of observers) observer.disconnect();
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("visibilitychange", sampleLoop);
		},
	};
	return api;
}
export type AppPerformance = ReturnType<typeof createBrowserPerformance>;
