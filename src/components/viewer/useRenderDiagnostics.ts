import type { RefObject } from "react";
import { useEffect, useState } from "react";
import type { RendererResult } from "../../engine";
import type { RenderDiagnostics } from "./types/RenderDiagnostics";

export function useRenderDiagnostics(
	session: RendererResult | null,
	sample: RefObject<{ frames: number; totalMs: number; peakMs: number }>,
	active: boolean,
) {
	const [diagnostics, setDiagnostics] = useState<RenderDiagnostics>({
		fps: 0,
		averageMs: 0,
		peakMs: 0,
		width: 0,
		height: 0,
		drawCalls: 0,
		triangles: 0,
		geometries: 0,
		textures: 0,
	});
	useEffect(() => {
		if (!session || !active) return;
		let sampleStart = performance.now();
		sample.current = { frames: 0, totalMs: 0, peakMs: 0 };
		const reset = () => {
			sampleStart = performance.now();
			sample.current = { frames: 0, totalMs: 0, peakMs: 0 };
			setDiagnostics((current) => ({ ...current, fps: 0 }));
		};
		const interval = window.setInterval(() => {
			const now = performance.now();
			const elapsed = now - sampleStart;
			const frames =
				document.hidden || elapsed <= 0 ? 0 : sample.current.frames;
			const averageMs = frames ? sample.current.totalMs / frames : null;
			const peakMs = frames ? sample.current.peakMs : null;
			const { width, height } = session.canvas;
			const rendererStats = session.renderer.getDiagnostics?.();
			setDiagnostics((current) => {
				if (
					!frames &&
					!current.fps &&
					current.width === width &&
					current.height === height
				)
					return current;
				return {
					...current,
					...rendererStats,
					fps: frames ? Math.round((frames * 1000) / elapsed) : 0,
					averageMs: averageMs ?? current.averageMs,
					peakMs: peakMs ?? current.peakMs,
					width,
					height,
				};
			});
			sample.current = { frames: 0, totalMs: 0, peakMs: 0 };
			sampleStart = now;
		}, 500);
		document.addEventListener("visibilitychange", reset);
		return () => {
			window.clearInterval(interval);
			document.removeEventListener("visibilitychange", reset);
		};
	}, [session, sample, active]);
	return diagnostics;
}
