import type { ProjectStorage } from "@ecad/core/projects/storage.ts";
import type { AppSettings } from "@ecad/core/settings/schema.ts";
import type { SettingsStorage } from "@ecad/core/settings/store.ts";
import type { SymbolLibraryStorage } from "@ecad/core/symbol-library/storage.tsx";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type {
	DesktopSettingsBridge,
	DesktopSymbolLibraryBridge,
	LoadedDesktopSettings,
} from "#/bridge.ts";
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
	function notify<Args extends unknown[], Result>(
		call: (...args: Args) => Promise<Result>,
	): (...args: Args) => Promise<Result>;
	function notify<Args extends unknown[], Result>(
		call: ((...args: Args) => Promise<Result>) | undefined,
	): ((...args: Args) => Promise<Result>) | undefined;
	function notify<Args extends unknown[], Result>(
		call: ((...args: Args) => Promise<Result>) | undefined,
	) {
		return (
			call &&
			(async (...args: Args) => {
				const result = await call(...args);
				for (const listener of listeners) listener();
				return result;
			})
		);
	}
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
		),
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
		saveSettings: decoded(bridge, bridge.saveSettings),
		refresh: decoded(bridge, bridge.refresh),
		subscribeExternalChanges: bridge.subscribeExternalChanges?.bind(bridge),
	};
}

export async function createDesktopSettingsStorage(
	bridge: DesktopSettingsBridge,
): Promise<SettingsStorage> {
	let loaded: LoadedDesktopSettings;
	try {
		loaded = await decodeIpcErrors(() => bridge.load())();
	} catch (cause) {
		loaded = {
			path: "the desktop settings file",
			settings: { version: 1 },
			error: errorMessage(cause, "Unable to read settings."),
		};
	}
	let { settings, error } = loaded;
	const save = decodeIpcErrors((next: AppSettings) => bridge.save(next));
	return {
		location: `to ${loaded.path}`,
		load() {
			if (error) throw new Error(error);
			return settings;
		},
		async save(next) {
			await save(next);
			settings = next;
			error = undefined;
		},
	};
}
