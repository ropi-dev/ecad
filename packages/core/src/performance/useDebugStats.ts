import { useEffect } from "react";
import { updateAppSettings, useAppSettings } from "#/settings/store.ts";

export const setDebugStats = (debugStats: boolean) =>
	updateAppSettings((current) => ({ ...current, debugStats })).catch(
		() => undefined,
	);

/**
 * Listens for Ctrl+Shift+D, which toggles the debug stats window, and returns
 * whether the window is shown.
 */
export function useDebugStats(): boolean {
	const shown = useAppSettings().debugStats ?? false;
	useEffect(() => {
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
			void updateAppSettings((current) => ({
				...current,
				debugStats: !current.debugStats,
			})).catch(() => undefined);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
	return shown;
}
