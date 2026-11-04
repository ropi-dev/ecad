import type { ProjectStorage } from "@ecad/core/projects/storage.ts";
import type { SymbolLibraryStorage } from "@ecad/core/symbol-library/storage.tsx";
import type { DesktopSymbolLibraryBridge } from "#/bridge.ts";
import { decodeIpcErrors } from "#/ipc-errors.ts";

function decoded<Args extends unknown[], Result>(
	bridge: object,
	call: ((...args: Args) => Promise<Result>) | undefined,
) {
	return call && decodeIpcErrors<Args, Result>(call.bind(bridge));
}

export function createDesktopSymbolLibraryStorage(
	bridge: DesktopSymbolLibraryBridge,
): SymbolLibraryStorage {
	const listeners = new Set<() => void>();
	const notify = <Args extends unknown[], Result>(
		call: ((...args: Args) => Promise<Result>) | undefined,
	) =>
		call &&
		(async (...args: Args) => {
			const result = await call(...args);
			for (const listener of listeners) listener();
			return result;
		});
	return {
		mode: "desktop",
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		load: decodeIpcErrors(() => bridge.load()),
		save: notify(
			decodeIpcErrors((symbols, additions) => bridge.save(symbols, additions)),
		)!,
		openDirectory: decodeIpcErrors(() => bridge.openDirectory()),
		loadConfiguration: decoded(bridge, bridge.loadConfiguration),
		saveConfiguration: notify(decoded(bridge, bridge.saveConfiguration)),
		openLibraryDirectory: decoded(bridge, bridge.openLibraryDirectory),
		loadDirectory: decoded(bridge, bridge.loadDirectory),
		canWriteConfiguration: decoded(bridge, bridge.canWriteConfiguration),
		inspectDirectorySymbol: decoded(bridge, bridge.inspectDirectorySymbol),
		saveDirectorySymbol: notify(decoded(bridge, bridge.saveDirectorySymbol)),
	};
}

export function createDesktopProjectStorage(
	bridge: ProjectStorage,
): ProjectStorage {
	return {
		mode: "desktop",
		load: decodeIpcErrors(() => bridge.load()),
		list: decodeIpcErrors(() => bridge.list()),
		create: decodeIpcErrors((name) => bridge.create(name)),
		open: decodeIpcErrors((name) => bridge.open(name)),
		save: decodeIpcErrors((directory, document) =>
			bridge.save(directory, document),
		),
		saveProject: decoded(bridge, bridge.saveProject),
		importAssets: decodeIpcErrors((directory, assets) =>
			bridge.importAssets(directory, assets),
		),
		readAsset: decodeIpcErrors((directory, path) =>
			bridge.readAsset(directory, path),
		),
		canWriteFile: decoded(bridge, bridge.canWriteFile),
	};
}
