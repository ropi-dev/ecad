import { type Accessor, createMemo } from "solid-js";
import {
	activeTheme,
	type SchematicTheme,
	schematicThemes,
	setActiveTheme,
	type ThemeName,
	type ViewerTheme,
	viewerThemes,
} from "#/drawing/schematic-theme.ts";
import { fromExternalStore } from "#/lib/external-store.ts";
import type { ThemeMode } from "#/settings/schema.ts";
import { getAppSettings, subscribeAppSettings } from "#/settings/store.ts";

export const resolveTheme = (
	mode: ThemeMode | undefined,
	systemLight: boolean,
): ThemeName =>
	mode === "light" || mode === "dark" ? mode : systemLight ? "light" : "dark";

const listeners = new Set<() => void>();
let stop: (() => void) | undefined;

export function watchTheme(): () => void {
	if (stop || typeof window === "undefined") return () => {};
	const system = window.matchMedia("(prefers-color-scheme: light)");
	const refresh = () => {
		const next = resolveTheme(getAppSettings().theme, system.matches);
		document.documentElement.dataset.theme = next;
		if (next === activeTheme()) return;
		setActiveTheme(next);
		for (const listener of listeners) listener();
	};
	const stopSettings = subscribeAppSettings(refresh);
	system.addEventListener("change", refresh);
	refresh();
	stop = () => {
		stopSettings();
		system.removeEventListener("change", refresh);
		stop = undefined;
	};
	return stop;
}

watchTheme();
if (import.meta.hot) import.meta.hot.dispose(() => stop?.());

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export const useTheme = (): Accessor<ThemeName> =>
	fromExternalStore(subscribe, activeTheme);

export function useSchematicTheme(): Accessor<SchematicTheme> {
	const theme = useTheme();
	return createMemo(() => schematicThemes[theme()]);
}

export function useViewerTheme(): Accessor<ViewerTheme> {
	const theme = useTheme();
	return createMemo(() => viewerThemes[theme()]);
}
