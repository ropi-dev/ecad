import {
	parseSavedSymbolLibrary,
	SYMBOL_STORAGE_KEY,
} from "@ecad/core/components/editor/symbolFormat.ts";
import {
	defaultSymbolConfig,
	parseSymbolConfig,
	serializeSymbolConfig,
	USER_SYMBOL_CONFIG_KEY,
} from "@ecad/core/symbol-library/config.ts";
import type { SymbolLibraryStorage } from "@ecad/core/symbol-library/storage.tsx";

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export function createWebSymbolLibraryStorage(
	storage?: BrowserStorage,
): SymbolLibraryStorage {
	const browserStorage = () => storage ?? globalThis.localStorage;
	const changeEvent = "ecad-user-symbol-config-changed";
	return {
		mode: "web",
		async load() {
			try {
				const saved = browserStorage().getItem(SYMBOL_STORAGE_KEY);
				return { symbols: saved ? parseSavedSymbolLibrary(saved) : [] };
			} catch {
				throw new Error(
					"Saved symbols could not be loaded. You can upload a library again.",
				);
			}
		},
		async save(symbols) {
			try {
				browserStorage().setItem(SYMBOL_STORAGE_KEY, JSON.stringify(symbols));
				return "Saved in this browser.";
			} catch {
				return "Browser storage is unavailable; these symbols will be lost when you leave or reload the editor.";
			}
		},
		async loadConfiguration() {
			try {
				const saved = browserStorage().getItem(USER_SYMBOL_CONFIG_KEY);
				if (saved !== null) return parseSymbolConfig(saved);
				const config = defaultSymbolConfig();
				const legacy = browserStorage().getItem(SYMBOL_STORAGE_KEY);
				if (legacy === null) return config;
				return {
					...config,
					symbolLibraries: [
						...config.symbolLibraries,
						{
							id: "imported",
							name: "Imported symbols",
							enabled: true,
							source: {
								kind: "embedded" as const,
								symbols: parseSavedSymbolLibrary(legacy),
							},
						},
					],
				};
			} catch {
				throw new Error(
					"Saved symbols could not be loaded. You can upload a library again.",
				);
			}
		},
		async saveConfiguration(config) {
			const contents = serializeSymbolConfig(config);
			try {
				browserStorage().setItem(USER_SYMBOL_CONFIG_KEY, contents);
				if (!storage && typeof window !== "undefined")
					window.dispatchEvent(new Event(changeEvent));
				return "Saved in this browser.";
			} catch {
				return "Browser storage is unavailable; these symbols will be lost when you leave or reload the editor.";
			}
		},
		subscribe(listener) {
			if (storage || typeof window === "undefined") return () => {};
			const onStorage = (event: StorageEvent) => {
				if (event.key === USER_SYMBOL_CONFIG_KEY || event.key === null)
					listener();
			};
			window.addEventListener(changeEvent, listener);
			window.addEventListener("storage", onStorage);
			return () => {
				window.removeEventListener(changeEvent, listener);
				window.removeEventListener("storage", onStorage);
			};
		},
	};
}
