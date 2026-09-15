import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { RendererResult } from "../../engine";
import { createRenderer } from "../../engine";
import { viewerPixelRatio } from "../../engine/navigation";
import type { Camera, GraphicsRenderer, SceneLayer } from "../../engine/types";
import { useRenderDiagnostics } from "./useRenderDiagnostics";
import { useRenderFrame } from "./useRenderFrame";

export function useGerberRenderer(
	renderer: RefObject<GraphicsRenderer | null>,
	layers: readonly SceneLayer[],
	camera: Camera,
	size: { width: number; height: number },
	selectedIds: ReadonlySet<string> | undefined,
	focusedLayerId?: string,
) {
	const canvasHost = useRef<HTMLDivElement>(null);
	const { draw, schedule, cancel } = useRenderFrame();
	const sample = useRef({ frames: 0, totalMs: 0, peakMs: 0 });
	const [session, setSession] = useState<RendererResult | null>(null);
	const [message, setMessage] = useState("");
	const [unavailable, setUnavailable] = useState(false);
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
				setMessage("");
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
			cancel();
		};
	}, [renderer, schedule, cancel]);
	useEffect(() => {
		if (!session || unavailable) {
			draw.current = () => {};
			return;
		}
		draw.current = () => {
			try {
				const started = performance.now();
				session.renderer.render(session.canvas, layers, {
					...size,
					camera,
					pixelRatio: viewerPixelRatio(),
					grid: false,
					selectedIds,
					focusedLayerId,
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
	}, [
		session,
		unavailable,
		layers,
		camera,
		size,
		selectedIds,
		focusedLayerId,
		schedule,
		draw,
	]);
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
