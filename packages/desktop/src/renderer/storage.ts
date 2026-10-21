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
		loadConfiguration: bridge.loadConfiguration?.bind(bridge),
		saveConfiguration: bridge.saveConfiguration?.bind(bridge),
		openLibraryDirectory: bridge.openLibraryDirectory?.bind(bridge),
		loadDirectory: bridge.loadDirectory?.bind(bridge),
		canWriteConfiguration: bridge.canWriteConfiguration?.bind(bridge),
		inspectDirectorySymbol: bridge.inspectDirectorySymbol?.bind(bridge),
		saveDirectorySymbol: bridge.saveDirectorySymbol?.bind(bridge),
	};
}
