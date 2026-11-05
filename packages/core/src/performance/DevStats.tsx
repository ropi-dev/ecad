import { useEffect, useRef, useState } from "react";
import type {
	PerformanceData,
	PerformanceSample,
} from "#/performance/recorder.ts";
import { getAppPerformance } from "#/performance/runtime.ts";

const STORAGE_KEY = "ecad.dev-stats";
const WINDOW_MS = 1000;
const LONG_TASK_WINDOW_MS = 10_000;
const FRAME_HISTORY = 120;

interface Stats {
	fps: number | null;
	renders: number;
	frameMs: number | null;
	frameP95: number | null;
	drawCalls: number | null;
	triangles: number | null;
	geometries: number | null;
	textures: number | null;
	shapes: number | null;
	sceneUpdateMs: number | null;
	longTasks: number;
	longestTaskMs: number;
	heapMb: number | null;
	domNodes: number;
	recorder: boolean;
}

const readVisible = () => {
	if (navigator.webdriver) return false;
	try {
		return localStorage.getItem(STORAGE_KEY) !== "0";
	} catch {
		return true;
	}
};

const storeVisible = (visible: boolean) => {
	try {
		localStorage.setItem(STORAGE_KEY, visible ? "1" : "0");
	} catch {}
};

const number = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const ms = (value: number | null) =>
	value === null ? "–" : `${value.toFixed(value < 10 ? 2 : 1)} ms`;

const count = (value: number | null) =>
	value === null ? "–" : value.toLocaleString();

export default function DevStats() {
	const [visible, setVisible] = useState<boolean | null>(null);
	const [stats, setStats] = useState<Stats | null>(null);
	const frameTimes = useRef<number[]>([]);
	const renderTimes = useRef<number[]>([]);
	const frameDurations = useRef<number[]>([]);
	const longTasks = useRef<{ at: number; duration: number }[]>([]);
	const latest = useRef<{
		frame?: PerformanceData;
		frameMs?: number;
		shapes?: number;
		sceneUpdateMs?: number;
	}>({});
	const subscribed = useRef(false);

	useEffect(() => {
		setVisible(readVisible());
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				!event.ctrlKey ||
				!event.shiftKey ||
				event.altKey ||
				event.metaKey ||
				event.key.toLowerCase() !== "d" ||
				event.defaultPrevented
			)
				return;
			event.preventDefault();
			if (event.repeat) return;
			setVisible((current) => {
				storeVisible(!current);
				return !current;
			});
		};
		const since = (times: number[], at: number, window: number) => {
			while (times.length && times[0] < at - window) times.shift();
		};
		const receive = (sample: PerformanceSample) => {
			const at = sample.startTime + sample.duration;
			if (sample.name === "renderer.frame") {
				renderTimes.current.push(at);
				since(renderTimes.current, at, WINDOW_MS);
				const durations = frameDurations.current;
				durations.push(sample.duration);
				if (durations.length > FRAME_HISTORY) durations.shift();
				latest.current.frame = sample.data;
				latest.current.frameMs = sample.duration;
			} else if (sample.name === "editor.scene-update") {
				latest.current.shapes = number(sample.data?.shapes) ?? undefined;
				latest.current.sceneUpdateMs = sample.duration;
			} else if (sample.name === "browser.long-task") {
				const tasks = longTasks.current;
				tasks.push({ at, duration: sample.duration });
				while (tasks.length && tasks[0].at < at - LONG_TASK_WINDOW_MS)
					tasks.shift();
			}
		};
		renderTimes.current = [];
		frameDurations.current = [];
		longTasks.current = [];
		latest.current = {};
		const recorder = getAppPerformance();
		for (const sample of recorder?.snapshot().events ?? []) receive(sample);
		const unsubscribe = recorder?.subscribe(receive);
		subscribed.current = unsubscribe !== undefined;
		window.addEventListener("keydown", onKeyDown);
		return () => {
			unsubscribe?.();
			window.removeEventListener("keydown", onKeyDown);
		};
	}, []);

	useEffect(() => {
		if (!visible) return;
		frameTimes.current = [];
		const opened = performance.now();
		let frame = requestAnimationFrame(function tick(now) {
			frameTimes.current.push(now);
			frame = requestAnimationFrame(tick);
		});
		const update = () => {
			const now = performance.now();
			const prune = (times: number[]) => {
				const first = times.findIndex((time) => time >= now - WINDOW_MS);
				times.splice(0, first === -1 ? times.length : first);
				return times.length;
			};
			longTasks.current = longTasks.current.filter(
				(task) => task.at >= now - LONG_TASK_WINDOW_MS,
			);
			const sorted = [...frameDurations.current].sort((a, b) => a - b);
			const { frame: data, frameMs, shapes, sceneUpdateMs } = latest.current;
			const frames = prune(frameTimes.current);
			const elapsed = now - opened;
			setStats({
				fps:
					elapsed >= WINDOW_MS
						? frames
						: elapsed >= 250
							? Math.round((frames * WINDOW_MS) / elapsed)
							: null,
				renders: prune(renderTimes.current),
				frameMs: frameMs ?? null,
				frameP95: sorted.length
					? sorted[Math.ceil(sorted.length * 0.95) - 1]
					: null,
				drawCalls: number(data?.calls),
				triangles: number(data?.triangles),
				geometries: number(data?.geometries),
				textures: number(data?.textures),
				shapes: shapes ?? null,
				sceneUpdateMs: sceneUpdateMs ?? null,
				longTasks: longTasks.current.length,
				longestTaskMs: Math.max(
					0,
					...longTasks.current.map((task) => task.duration),
				),
				heapMb:
					(performance as Performance & { memory?: { usedJSHeapSize: number } })
						.memory?.usedJSHeapSize ?? null,
				domNodes: document.getElementsByTagName("*").length,
				recorder: subscribed.current,
			});
		};
		const timer = setInterval(update, 500);
		update();
		return () => {
			cancelAnimationFrame(frame);
			clearInterval(timer);
			setStats(null);
		};
	}, [visible]);

	if (!visible || !stats) return null;
	const rows: [string, string][] = [
		["FPS", count(stats.fps)],
		["Renders/s", stats.recorder ? String(stats.renders) : "–"],
		["Frame", ms(stats.frameMs)],
		["Frame p95", ms(stats.frameP95)],
		["Draw calls", count(stats.drawCalls)],
		["Triangles", count(stats.triangles)],
		["Geometries", count(stats.geometries)],
		["Textures", count(stats.textures)],
		["Shapes", count(stats.shapes)],
		["Scene update", ms(stats.sceneUpdateMs)],
		[
			"Long tasks 10s",
			stats.longTasks
				? `${stats.longTasks} (max ${Math.round(stats.longestTaskMs)} ms)`
				: "0",
		],
		[
			"JS heap",
			stats.heapMb === null
				? "–"
				: `${(stats.heapMb / 1024 / 1024).toFixed(1)} MB`,
		],
		["DOM nodes", stats.domNodes.toLocaleString()],
	];
	return (
		<section
			aria-label="Development stats"
			data-shortcut-scope="none"
			className="pointer-events-none fixed right-7 bottom-[4.5rem] z-[90] min-w-48 rounded-md border border-white/10 bg-black/75 px-2.5 py-2 font-mono text-[11px] leading-4 text-[#e8e9ec] shadow-lg backdrop-blur-sm"
		>
			<header className="mb-1 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wide text-white/50">
				<span>Dev stats · Ctrl+Shift+D</span>
				<button
					type="button"
					aria-label="Hide development stats"
					className="pointer-events-auto rounded px-1 text-white/60 hover:bg-white/10 hover:text-white"
					onClick={() => {
						storeVisible(false);
						setVisible(false);
					}}
				>
					×
				</button>
			</header>
			<dl className="grid grid-cols-[auto_auto] gap-x-4">
				{rows.map(([label, value]) => (
					<div key={label} className="contents">
						<dt className="text-white/55">{label}</dt>
						<dd className="m-0 text-right tabular-nums">{value}</dd>
					</div>
				))}
			</dl>
			{!stats.recorder && (
				<p className="mt-1 max-w-48 text-[10px] text-amber-300/80">
					Recorder off (?perf=0), only FPS is live.
				</p>
			)}
		</section>
	);
}
