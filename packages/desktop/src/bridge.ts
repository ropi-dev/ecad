import type { SymbolLibrary } from "@ecad/core/components/editor/symbolFormat.ts";
import type { ProjectStorage } from "@ecad/core/projects/storage.ts";
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
	}
}

export const displayChannels = {
	getCalibration: "display:calibration",
	changed: "display:changed",
} as const;

/** Renderer-to-main request channels. The main process validates their arguments. */
export type InvokeChannel =
	| (typeof libraryChannels)[keyof typeof libraryChannels]
	| (typeof projectChannels)[keyof typeof projectChannels]
	| typeof displayChannels.getCalibration;
