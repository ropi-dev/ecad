import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type {
	PerformanceData,
	PerformanceSample,
} from "#/performance/recorder.ts";
import { getAppPerformance } from "#/performance/runtime.ts";

const STORAGE_KEY = "ecad.dev-stats";
const POSITION_KEY = "ecad.dev-stats-position";
/** Space kept between the window and the viewport edges. */
const MARGIN = 8;
const KEY_STEP = 16;
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

interface Position {
	x: number;
	y: number;
}

const readPosition = (): Position | null => {
	try {
		const value: unknown = JSON.parse(
			localStorage.getItem(POSITION_KEY) ?? "null",
		);
		if (
			value &&
			typeof value === "object" &&
			"x" in value &&
			"y" in value &&
			Number.isFinite(value.x) &&
			Number.isFinite(value.y)
		)
			return { x: Number(value.x), y: Number(value.y) };
	} catch {}
	return null;
};

const storePosition = (position: Position) => {
	try {
		localStorage.setItem(POSITION_KEY, JSON.stringify(position));
	} catch {}
};

/** Keeps the whole window on screen, or its top left when it cannot fit. */
const clampPosition = (
	position: Position,
	size: { width: number; height: number },
): Position => ({
	x: Math.max(
		MARGIN,
		Math.min(position.x, window.innerWidth - size.width - MARGIN),
	),
	y: Math.max(
		MARGIN,
		Math.min(position.y, window.innerHeight - size.height - MARGIN),
	),
});

const sizeOf = (element: HTMLElement | null) => ({
	width: element?.offsetWidth ?? 0,
	height: element?.offsetHeight ?? 0,
});

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
	return (
		<StatsWindow
			stats={stats}
			onHide={() => {
				storeVisible(false);
				setVisible(false);
			}}
		/>
	);
}

/**
 * A floating window that the header moves by dragging, or by the arrow keys
 * while the move handle has focus. It remembers its place between sessions.
 */
function StatsWindow({ stats, onHide }: { stats: Stats; onHide: () => void }) {
	const element = useRef<HTMLElement>(null);
	const drag = useRef<{
		pointerId: number;
		dx: number;
		dy: number;
		/** The latest position, saved when the drag ends. */
		at: Position;
	} | null>(null);
	const [position, setPosition] = useState<Position | null>(readPosition);
	// The first time, open at the bottom left of the canvas, clear of the
	// sidebar and the toolbar.
	useLayoutEffect(() => {
		const { width, height } = sizeOf(element.current);
		setPosition((current) =>
			clampPosition(
				current ?? { x: 272, y: window.innerHeight - height - 72 },
				{ width, height },
			),
		);
	}, []);
	useEffect(() => {
		const keepOnScreen = () =>
			setPosition(
				(current) => current && clampPosition(current, sizeOf(element.current)),
			);
		window.addEventListener("resize", keepOnScreen);
		return () => window.removeEventListener("resize", keepOnScreen);
	}, []);
	const moveTo = (next: Position) => {
		const clamped = clampPosition(next, sizeOf(element.current));
		setPosition(clamped);
		return clamped;
	};
	const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
		if (event.button !== 0 || !position) return;
		if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = {
			pointerId: event.pointerId,
			dx: event.clientX - position.x,
			dy: event.clientY - position.y,
			at: position,
		};
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
		const current = drag.current;
		if (!current || current.pointerId !== event.pointerId) return;
		current.at = moveTo({
			x: event.clientX - current.dx,
			y: event.clientY - current.dy,
		});
	};
	const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
		const current = drag.current;
		if (current?.pointerId !== event.pointerId) return;
		drag.current = null;
		storePosition(current.at);
	};
	const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
		if (!position) return;
		const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
		const offsets: Record<string, Position> = {
			ArrowLeft: { x: -step, y: 0 },
			ArrowRight: { x: step, y: 0 },
			ArrowUp: { x: 0, y: -step },
			ArrowDown: { x: 0, y: step },
		};
		const offset = offsets[event.key];
		if (!offset) return;
		event.preventDefault();
		event.stopPropagation();
		storePosition(
			moveTo({ x: position.x + offset.x, y: position.y + offset.y }),
		);
	};
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
			ref={element}
			aria-label="Development stats"
			data-shortcut-scope="none"
			className="fixed top-0 left-0 z-[90] min-w-48 rounded-md border border-white/15 bg-black/80 font-mono text-[11px] leading-4 text-[#e8e9ec] shadow-[0_8px_32px_#0008] backdrop-blur-sm"
			style={{
				transform: position
					? `translate(${position.x}px, ${position.y}px)`
					: undefined,
				visibility: position ? undefined : "hidden",
			}}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<header
				className="flex cursor-grab touch-none items-center justify-between gap-3 rounded-t-md border-b border-white/10 bg-white/5 py-1 pr-1 pl-2.5 text-[10px] uppercase tracking-wide text-white/50 select-none active:cursor-grabbing"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			>
				<button
					type="button"
					aria-label="Move development stats with the arrow keys"
					title="Drag to move. Arrow keys move it too."
					className="cursor-grab rounded px-0.5 text-left uppercase focus-visible:outline-1 focus-visible:outline-white/60"
					onKeyDown={onKeyDown}
				>
					Dev stats · Ctrl+Shift+D
				</button>
				<button
					type="button"
					data-no-drag
					aria-label="Hide development stats"
					className="rounded px-1 text-white/60 hover:bg-white/10 hover:text-white"
					onClick={onHide}
				>
					×
				</button>
			</header>
			<div className="px-2.5 pt-1 pb-2">
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
			</div>
		</section>
	);
}
