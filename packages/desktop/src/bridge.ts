import type { SymbolLibrary } from "@ecad/core/components/editor/symbolFormat.ts";
import type { SymbolLibrarySnapshot } from "@ecad/core/symbol-library/storage.tsx";

export interface DesktopSymbolLibraryBridge {
	load(): Promise<SymbolLibrarySnapshot>;
	save(symbols: SymbolLibrary, additions: SymbolLibrary): Promise<string>;
	openDirectory(): Promise<SymbolLibrarySnapshot | null>;
}

export const libraryChannels = {
	load: "symbol-library:load",
	save: "symbol-library:save",
	openDirectory: "symbol-library:open-directory",
} as const;

declare global {
	interface Window {
		ecadSymbolLibrary: DesktopSymbolLibraryBridge;
	}
}
