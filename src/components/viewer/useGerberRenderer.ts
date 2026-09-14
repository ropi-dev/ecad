import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RendererResult } from "../../engine";
import { createRenderer } from "../../engine";
import type { Camera, GraphicsRenderer, SceneLayer } from "../../engine/types";
import { useRenderDiagnostics } from "./useRenderDiagnostics";

export function useGerberRenderer(
	renderer: RefObject<GraphicsRenderer | null>,
	layer: SceneLayer,
	camera: Camera,
	size: { width: number; height: number },
	selectedIds: ReadonlySet<string> | undefined,
) {
	const canvasHost = useRef<HTMLDivElement>(null);
	const frame = useRef<number | null>(null);
	const draw = useRef<() => void>(() => {});
	const sample = useRef({ frames: 0, totalMs: 0, peakMs: 0 });
	const [session, setSession] = useState<RendererResult | null>(null);
	const [message, setMessage] = useState("");
	const [unavailable, setUnavailable] = useState(false);
	const schedule = useCallback(() => {
		if (frame.current !== null) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = null;
			draw.current();
		});
	}, []);
	useEffect(() => {
		const host = canvasHost.current;
		if (!host) return;
		let disposed = false;
		let active: GraphicsRenderer | null = null;
		let target = document.createElement("canvas");
		target.tabIndex = 0;
		target.setAttribute("aria-label", "Gerber file drawing");
		host.appendChild(target);
		const onError = (event: Event) => {
			setUnavailable(true);
			setMessage((event as CustomEvent<string>).detail);
		};
		void createRenderer(target)
			.then((result) => {
				if (disposed) {
					result.renderer.dispose?.();
					return;
				}
				if (result.canvas !== target) {
					target.replaceWith(result.canvas);
					target = result.canvas;
					target.tabIndex = 0;
					target.setAttribute("aria-label", "Gerber file drawing");
				}
				target.addEventListener("renderererror", onError);
				target.addEventListener("renderinvalidated", schedule);
				active = result.renderer;
				renderer.current = active;
				setSession(result);
				setMessage(result.reason ?? "");
			})
			.catch((error: unknown) => {
				if (!disposed) {
					setUnavailable(true);
					setMessage(
						error instanceof Error
							? error.message
							: "Unable to start the renderer.",
					);
				}
			});
		return () => {
			disposed = true;
			target.removeEventListener("renderererror", onError);
			target.removeEventListener("renderinvalidated", schedule);
			active?.dispose?.();
			target.remove();
			if (renderer.current === active) renderer.current = null;
			if (frame.current !== null) cancelAnimationFrame(frame.current);
			frame.current = null;
			draw.current = () => {};
		};
	}, [renderer, schedule]);
	useEffect(() => {
		if (!session || unavailable) {
			draw.current = () => {};
			return;
		}
		draw.current = () => {
			try {
				const started = performance.now();
				session.renderer.render(session.canvas, [layer], {
					...size,
					camera,
					pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
					grid: false,
					selectedIds,
					background: "#111318",
				});
				const duration = performance.now() - started;
				sample.current.totalMs += duration;
				sample.current.peakMs = Math.max(sample.current.peakMs, duration);
				sample.current.frames++;
			} catch (error) {
				setMessage(
					error instanceof Error ? error.message : "Unable to draw this file.",
				);
			}
		};
		schedule();
	}, [session, unavailable, layer, camera, size, selectedIds, schedule]);
	const diagnostics = useRenderDiagnostics(session, sample, !unavailable);
	const backend = unavailable
		? "Renderer unavailable"
		: session
			? session.backend === "Canvas 2D"
				? "Canvas fallback"
				: `${session.backend} · Three.js`
			: "";
	return { canvasHost, backend, message, diagnostics };
}
