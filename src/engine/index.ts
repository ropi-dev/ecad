import { CanvasRenderer } from "./canvas";
import type { GraphicsRenderer } from "./types";

export {
	fitCamera,
	getSceneBounds,
	screenToWorld,
	worldToScreen,
} from "./camera";
export * from "./types";

export interface RendererResult {
	renderer: GraphicsRenderer;
	canvas: HTMLCanvasElement;
	backend: "WebGPU" | "WebGL 2" | "Canvas 2D";
	reason?: string;
}

export async function createRenderer(
	canvas: HTMLCanvasElement,
): Promise<RendererResult> {
	try {
		const { ThreeRenderer } = await import("./three");
		const renderer = await ThreeRenderer.create(canvas);
		return { renderer, canvas, backend: renderer.backend };
	} catch (error) {
		const fallback = canvas.ownerDocument.createElement("canvas");
		return {
			renderer: new CanvasRenderer(fallback),
			canvas: fallback,
			backend: "Canvas 2D",
			reason: `Three.js could not initialize: ${error instanceof Error ? error.message : String(error)}. Using Canvas 2D.`,
		};
	}
}
