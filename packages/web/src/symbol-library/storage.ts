import {
	parseSavedSymbolLibrary,
	SYMBOL_STORAGE_KEY,
} from "@ecad/core/components/editor/symbolFormat.ts";
import type { SymbolLibraryStorage } from "@ecad/core/symbol-library/storage.tsx";

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export function createWebSymbolLibraryStorage(
	storage?: BrowserStorage,
): SymbolLibraryStorage {
	const browserStorage = () => storage ?? globalThis.localStorage;
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
	};
}
