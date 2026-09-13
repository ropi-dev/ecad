import { CanvasRenderer } from "./canvas";
import type { GraphicsRenderer } from "./types";
import { WebGPURenderer } from "./webgpu";

export * from "./types";
export {
	fitCamera,
	getSceneBounds,
	screenToWorld,
	worldToScreen,
} from "./camera";

export interface RendererResult {
	renderer: GraphicsRenderer;
	backend: "WebGPU" | "Canvas 2D";
	accelerated: boolean;
	reason?: string;
}

/** Prefer WebGPU. The caller must display the returned backend and fallback reason. */
export async function createRenderer(
	canvas: HTMLCanvasElement,
): Promise<RendererResult> {
	let reason =
		"WebGPU is unavailable in this browser. Use a WebGPU browser on HTTPS or localhost for hardware acceleration.";
	if (typeof navigator !== "undefined" && navigator.gpu) {
		try {
			const adapter = await navigator.gpu.requestAdapter({
				powerPreference: "high-performance",
			});
			if (adapter) {
				const renderer = await WebGPURenderer.create(canvas, adapter);
				return {
					renderer,
					backend: "WebGPU",
					accelerated: adapter.info?.isFallbackAdapter === false,
					reason: adapter.info?.isFallbackAdapter
						? "This browser supplied a software WebGPU adapter. Hardware acceleration is unavailable."
						: undefined,
				};
			}
			reason =
				"No WebGPU adapter is available. Check browser hardware acceleration settings.";
		} catch (error) {
			reason = `WebGPU could not initialize: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
	return {
		renderer: new CanvasRenderer(canvas),
		backend: "Canvas 2D",
		accelerated: false,
		reason,
	};
}
