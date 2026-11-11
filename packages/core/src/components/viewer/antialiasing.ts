import type { AntialiasingMode } from "#/settings/schema.ts";
import { useAppSettings } from "#/settings/store.ts";

const SOFTWARE_RENDERER =
	/swiftshader|llvmpipe|softpipe|software|basic render/i;

function detectSoftwareRenderer() {
	if (typeof document === "undefined") return false;
	try {
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
		if (!context) return false;
		const info = context.getExtension("WEBGL_debug_renderer_info");
		const renderer = String(
			context.getParameter(
				info ? info.UNMASKED_RENDERER_WEBGL : context.RENDERER,
			),
		);
		context.getExtension("WEBGL_lose_context")?.loseContext();
		return SOFTWARE_RENDERER.test(renderer);
	} catch {
		return false;
	}
}

let software: boolean | undefined;

export function automaticAntialiasing() {
	software ??= detectSoftwareRenderer();
	return !software;
}

export function resolveAntialiasing(mode: AntialiasingMode = "auto") {
	return mode === "auto" ? automaticAntialiasing() : mode === "on";
}

export function useAntialiasing() {
	return resolveAntialiasing(useAppSettings().antialiasing);
}
