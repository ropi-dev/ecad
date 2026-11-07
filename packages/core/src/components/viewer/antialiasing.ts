import { useSyncExternalStore } from "react";

const STORAGE_KEY = "ecad.antialias";
const SOFTWARE_RENDERER =
	/swiftshader|llvmpipe|softpipe|software|basic render/i;
const listeners = new Set<() => void>();

function softwareRenderer() {
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

function stored() {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		if (value !== null) return value !== "0";
	} catch {}
	return !softwareRenderer();
}

let enabled: boolean | undefined;

const current = () => {
	enabled ??= stored();
	return enabled;
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export function setAntialiasing(next: boolean) {
	enabled = next;
	try {
		localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
	} catch {}
	for (const listener of listeners) listener();
}

export function useAntialiasing() {
	return useSyncExternalStore(subscribe, current, () => true);
}
