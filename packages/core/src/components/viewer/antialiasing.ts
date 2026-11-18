import type { AntialiasingMode } from "#/settings/schema.ts";
import { useAppSettings } from "#/settings/store.ts";

const SOFTWARE_RENDERER =
	/swiftshader|llvmpipe|softpipe|software|basic render/i;

function detectRenderer() {
	if (typeof document === "undefined") return "";
	try {
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
		if (!context) return "";
		const info = context.getExtension("WEBGL_debug_renderer_info");
		const renderer = String(
			context.getParameter(
				info ? info.UNMASKED_RENDERER_WEBGL : context.RENDERER,
			),
		);
		context.getExtension("WEBGL_lose_context")?.loseContext();
		return renderer;
	} catch {
		return "";
	}
}

let renderer: string | undefined;

export const webglRenderer = () => (renderer ??= detectRenderer());

export const isSoftwareRenderer = (name: string) =>
	SOFTWARE_RENDERER.test(name);

export const automaticAntialiasing = () => !isSoftwareRenderer(webglRenderer());

export function resolveAntialiasing(mode: AntialiasingMode = "auto") {
	return mode === "auto" ? automaticAntialiasing() : mode === "on";
}

export function useAntialiasing() {
	return resolveAntialiasing(useAppSettings().antialiasing);
}
