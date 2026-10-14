import type { SymbolLibrary } from "@ecad/core/components/editor/symbolFormat.ts";
import type { ProjectStorage } from "@ecad/core/projects/storage.ts";
import type {
	ConfiguredSymbolLibrary,
	LibraryScope,
	SymbolLibraryConfig,
} from "@ecad/core/symbol-library/config.ts";
import type { SymbolLibrarySnapshot } from "@ecad/core/symbol-library/storage.tsx";

export interface DesktopSymbolLibraryBridge {
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
} as const;

export const projectChannels = {
	load: "projects:load",
	create: "projects:create",
	open: "projects:open",
	save: "projects:save",
	importAssets: "projects:import-assets",
	readAsset: "projects:read-asset",
} as const;

declare global {
	interface Window {
		ecadSymbolLibrary: DesktopSymbolLibraryBridge;
		ecadProjects: ProjectStorage;
	}
}
