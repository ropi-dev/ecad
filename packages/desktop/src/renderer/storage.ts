import type { SymbolLibraryStorage } from "@ecad/core/symbol-library/storage.tsx";
import type { DesktopSymbolLibraryBridge } from "#/bridge.ts";

export function createDesktopSymbolLibraryStorage(
	bridge: DesktopSymbolLibraryBridge,
): SymbolLibraryStorage {
	return {
		mode: "desktop",
		load: () => bridge.load(),
		save: (symbols, additions) => bridge.save(symbols, additions),
		openDirectory: () => bridge.openDirectory(),
	};
}
