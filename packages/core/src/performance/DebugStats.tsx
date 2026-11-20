import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type {
	PerformanceData,
	PerformanceSample,
} from "#/performance/recorder.ts";
import {
	acquirePerformance,
	getAppPerformance,
} from "#/performance/runtime.ts";
import { setDebugStats } from "#/performance/useDebugStats.ts";

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

const sizeOf = (element: HTMLElement | undefined) => ({
	width: element?.offsetWidth ?? 0,
	height: element?.offsetHeight ?? 0,
});

const number = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const ms = (value: number | null) =>
	value === null ? "–" : `${value.toFixed(value < 10 ? 2 : 1)} ms`;

const count = (value: number | null) =>
	value === null ? "–" : value.toLocaleString();

/** Mounted while the debug stats setting is on. */
export default function DebugStats() {
	const [stats, setStats] = createSignal<Stats | null>(null);
	let frameTimes: number[] = [];
	let renderTimes: number[] = [];
	let frameDurations: number[] = [];
	let longTasks: { at: number; duration: number }[] = [];
	let latest: {
		frame?: PerformanceData;
		frameMs?: number;
		shapes?: number;
		sceneUpdateMs?: number;
	} = {};
	let subscribed = false;

	onSettled(() => {
		const release = acquirePerformance();
		const since = (times: number[], at: number, window: number) => {
			while (times.length && times[0] < at - window) times.shift();
		};
		const receive = (sample: PerformanceSample) => {
			const at = sample.startTime + sample.duration;
			if (sample.name === "renderer.frame") {
				renderTimes.push(at);
				since(renderTimes, at, WINDOW_MS);
				frameDurations.push(sample.duration);
				if (frameDurations.length > FRAME_HISTORY) frameDurations.shift();
				latest.frame = sample.data;
				latest.frameMs = sample.duration;
			} else if (sample.name === "editor.scene-update") {
				latest.shapes = number(sample.data?.shapes) ?? undefined;
				latest.sceneUpdateMs = sample.duration;
			} else if (sample.name === "browser.long-task") {
				longTasks.push({ at, duration: sample.duration });
				while (longTasks.length && longTasks[0].at < at - LONG_TASK_WINDOW_MS)
					longTasks.shift();
			}
		};
		renderTimes = [];
		frameDurations = [];
		longTasks = [];
		latest = {};
		const recorder = getAppPerformance();
		for (const sample of recorder?.snapshot().events ?? []) receive(sample);
		const unsubscribe = recorder?.subscribe(receive);
		subscribed = unsubscribe !== undefined;

		frameTimes = [];
		const opened = performance.now();
		let frame = requestAnimationFrame(function tick(now) {
			frameTimes.push(now);
			frame = requestAnimationFrame(tick);
		});
		const update = () => {
			const now = performance.now();
			const prune = (times: number[]) => {
				const first = times.findIndex((time) => time >= now - WINDOW_MS);
				times.splice(0, first === -1 ? times.length : first);
				return times.length;
			};
			longTasks = longTasks.filter(
				(task) => task.at >= now - LONG_TASK_WINDOW_MS,
			);
			const sorted = [...frameDurations].sort((a, b) => a - b);
			const { frame: data, frameMs, shapes, sceneUpdateMs } = latest;
			const frames = prune(frameTimes);
			const elapsed = now - opened;
			setStats({
				fps:
					elapsed >= WINDOW_MS
						? frames
						: elapsed >= 250
							? Math.round((frames * WINDOW_MS) / elapsed)
							: null,
				renders: prune(renderTimes),
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
				longTasks: longTasks.length,
				longestTaskMs: Math.max(0, ...longTasks.map((task) => task.duration)),
				heapMb:
					(performance as Performance & { memory?: { usedJSHeapSize: number } })
						.memory?.usedJSHeapSize ?? null,
				domNodes: document.getElementsByTagName("*").length,
				recorder: subscribed,
			});
		};
		const timer = setInterval(update, 500);
		update();
		return () => {
			unsubscribe?.();
			release();
			cancelAnimationFrame(frame);
			clearInterval(timer);
		};
	});

	return (
		<Show when={stats()}>
			{(current) => (
				<StatsWindow stats={current()} onHide={() => setDebugStats(false)} />
			)}
		</Show>
	);
}

/**
 * A floating window that the header moves by dragging, or by the arrow keys
 * while the move handle has focus. It remembers its place between sessions.
 */
function StatsWindow(props: { stats: Stats; onHide: () => void }) {
	let element!: HTMLElement;
	let drag: {
		pointerId: number;
		dx: number;
		dy: number;
		/** The latest position, saved when the drag ends. */
		at: Position;
	} | null = null;
	const [position, setPosition] = createSignal<Position | null>(readPosition());
	onSettled(() => {
		// The first time, open at the bottom left of the canvas, clear of the
		// sidebar and the toolbar.
		const { width, height } = sizeOf(element);
		setPosition((current) =>
			clampPosition(
				current ?? { x: 272, y: window.innerHeight - height - 72 },
				{ width, height },
			),
		);
		const keepOnScreen = () =>
			setPosition(
				(current) => current && clampPosition(current, sizeOf(element)),
			);
		window.addEventListener("resize", keepOnScreen);
		return () => window.removeEventListener("resize", keepOnScreen);
	});
	const moveTo = (next: Position) => {
		const clamped = clampPosition(next, sizeOf(element));
		setPosition(clamped);
		return clamped;
	};
	const onPointerDown: JSX.EventHandler<HTMLElement, PointerEvent> = (
		event,
	) => {
		const current = position();
		if (event.button !== 0 || !current) return;
		if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag = {
			pointerId: event.pointerId,
			dx: event.clientX - current.x,
			dy: event.clientY - current.y,
			at: current,
		};
	};
	const onPointerMove = (event: PointerEvent) => {
		if (!drag || drag.pointerId !== event.pointerId) return;
		drag.at = moveTo({
			x: event.clientX - drag.dx,
			y: event.clientY - drag.dy,
		});
	};
	const endDrag = (event: PointerEvent) => {
		const current = drag;
		if (current?.pointerId !== event.pointerId) return;
		drag = null;
		storePosition(current.at);
	};
	const onKeyDown = (event: KeyboardEvent) => {
		const current = position();
		if (!current) return;
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
		storePosition(moveTo({ x: current.x + offset.x, y: current.y + offset.y }));
	};
	const rows = createMemo((): [string, string][] => {
		const stats = props.stats;
		return [
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
	});
	return (
		<section
			ref={element}
			aria-label="Debug stats"
			data-shortcut-scope="none"
			class="ui-panel fixed top-0 left-0 z-[90] min-w-48 font-mono text-2xs leading-4"
			style={{
				transform: position()
					? `translate(${position()?.x}px, ${position()?.y}px)`
					: undefined,
				visibility: position() ? undefined : "hidden",
			}}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<header
				class="flex cursor-grab touch-none items-center justify-between gap-3 rounded-t-[inherit] border-b border-line-subtle bg-hover py-1 pr-1 pl-2.5 text-2xs tracking-wide text-fg-faint uppercase select-none active:cursor-grabbing"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			>
				<button
					type="button"
					aria-label="Move debug stats with the arrow keys"
					title="Drag to move. Arrow keys move it too."
					class="cursor-grab rounded-sm px-0.5 text-left uppercase focus-visible:outline-1 focus-visible:outline-accent"
					onKeyDown={onKeyDown}
				>
					Debug stats · Ctrl+Shift+D
				</button>
				<button
					type="button"
					data-no-drag
					aria-label="Hide debug stats"
					class="cursor-pointer rounded-sm px-1 text-fg-muted hover:bg-hover hover:text-fg"
					onClick={() => props.onHide()}
				>
					×
				</button>
			</header>
			<div class="px-2.5 pt-1 pb-2">
				<dl class="grid grid-cols-[auto_auto] gap-x-4">
					<For each={rows()} keyed={false}>
						{(row) => (
							<div class="contents">
								<dt class="text-fg-muted">{row()[0]}</dt>
								<dd class="m-0 text-right tabular-nums">{row()[1]}</dd>
							</div>
						)}
					</For>
				</dl>
				<Show when={!props.stats.recorder}>
					<p class="m-0 mt-1 max-w-48 text-2xs text-warning">
						Recorder off (?perf=0), only FPS is live.
					</p>
				</Show>
			</div>
		</section>
	);
}
