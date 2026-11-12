import type { SymbolLibrary } from "@ecad/core/components/editor/symbolFormat.ts";
import type { ProjectStorage } from "@ecad/core/projects/storage.ts";
import type { AppSettings } from "@ecad/core/settings/schema.ts";
import type {
	ConfiguredSymbolLibrary,
	LibraryScope,
	SymbolLibraryConfig,
} from "@ecad/core/symbol-library/config.ts";
import type {
	SymbolLibrarySnapshot,
	SymbolLibraryStorage,
} from "@ecad/core/symbol-library/storage.tsx";

export interface DesktopSymbolLibraryBridge
	extends Pick<
		SymbolLibraryStorage,
		"canWriteConfiguration" | "inspectDirectorySymbol" | "saveDirectorySymbol"
	> {
	load(): Promise<SymbolLibrarySnapshot>;
	save(symbols: SymbolLibrary, additions: SymbolLibrary): Promise<string>;
	openDirectory(): Promise<SymbolLibrarySnapshot | null>;
	loadConfiguration?(): Promise<SymbolLibraryConfig>;
	saveConfiguration?(config: SymbolLibraryConfig): Promise<string>;
	openLibraryDirectory?(name: string): Promise<ConfiguredSymbolLibrary | null>;
	loadDirectory?(
		path: string,
		scope: LibraryScope,
		projectDirectory?: string,
	): Promise<SymbolLibrary>;
}

export const libraryChannels = {
	load: "symbol-library:load",
	save: "symbol-library:save",
	openDirectory: "symbol-library:open-directory",
	loadConfiguration: "symbol-library:load-configuration",
	saveConfiguration: "symbol-library:save-configuration",
	openLibraryDirectory: "symbol-library:open-library-directory",
	loadDirectory: "symbol-library:load-directory",
	canWriteConfiguration: "symbol-library:can-write-configuration",
	inspectDirectorySymbol: "symbol-library:inspect-symbol",
	saveDirectorySymbol: "symbol-library:save-symbol",
} as const;

export const projectChannels = {
	load: "projects:load",
	create: "projects:create",
	open: "projects:open",
	save: "projects:save",
	saveProject: "projects:save-project",
	importAssets: "projects:import-assets",
	readAsset: "projects:read-asset",
	canWriteFile: "projects:can-write-file",
	saveSettings: "projects:save-settings",
	refresh: "projects:refresh",
} as const;

/** Main-to-renderer notifications about the open project. */
export const projectEvents = {
	changed: "projects:changed",
} as const;

declare global {
	interface Window {
		ecadSymbolLibrary: DesktopSymbolLibraryBridge;
		ecadProjects: ProjectStorage;
		ecadApp: DesktopAppBridge;
		ecadSettings: DesktopSettingsBridge;
		ecadUpdates: DesktopUpdatesBridge;
	}
}

export interface LoadedDesktopSettings {
	path: string;
	settings: AppSettings;
	error?: string;
}

export interface DesktopSettingsBridge {
	load(): Promise<LoadedDesktopSettings>;
	save(settings: AppSettings): Promise<void>;
}

export const settingsChannels = {
	load: "settings:load",
	save: "settings:save",
} as const;

/** Requests about the desktop app itself. */
export interface DesktopAppBridge {
	/** Quits the app. Unsaved changes still ask before the window closes. */
	quit(): Promise<void>;
}

export const appChannels = {
	quit: "app:quit",
} as const;

export interface DesktopRelease {
	version: string;
	changes: string[];
}

export type DesktopUpdateState =
	| { status: "idle"; latest?: DesktopRelease; checkError?: string }
	| { status: "checking"; latest?: DesktopRelease }
	| { status: "available"; latest: DesktopRelease }
	| { status: "downloading"; latest: DesktopRelease; progress: number }
	| { status: "installing"; latest: DesktopRelease }
	| { status: "installed"; latest: DesktopRelease }
	| { status: "failed"; latest: DesktopRelease; message: string };

export interface DesktopUpdatesBridge {
	/** @return null when this build does not update itself. */
	getState(): Promise<DesktopUpdateState | null>;
	check(): Promise<void>;
	install(): Promise<void>;
	restart(): Promise<void>;
	onChanged(listener: (state: DesktopUpdateState) => void): () => void;
}

export const updateChannels = {
	getState: "updates:get-state",
	check: "updates:check",
	install: "updates:install",
	restart: "updates:restart",
} as const;

export const updateEvents = {
	changed: "updates:changed",
} as const;

export const displayChannels = {
	getCalibration: "display:calibration",
	changed: "display:changed",
} as const;

/** Renderer-to-main request channels. The main process validates their arguments. */
export type InvokeChannel =
	| (typeof libraryChannels)[keyof typeof libraryChannels]
	| (typeof projectChannels)[keyof typeof projectChannels]
	| (typeof settingsChannels)[keyof typeof settingsChannels]
	| (typeof updateChannels)[keyof typeof updateChannels]
	| typeof displayChannels.getCalibration
	| typeof appChannels.quit;
