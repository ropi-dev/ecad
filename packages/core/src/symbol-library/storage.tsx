import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { SymbolLibrary } from "#/components/editor/symbolFormat.ts";

export interface SymbolLibrarySnapshot {
	symbols: SymbolLibrary;
	directory?: string;
}

/** Hosts own persistence and file access; the editor owns symbol validation. */
export interface SymbolLibraryStorage {
	mode: "web" | "desktop" | "memory";
	load(): Promise<SymbolLibrarySnapshot>;
	save(symbols: SymbolLibrary, additions: SymbolLibrary): Promise<string>;
	openDirectory?(): Promise<SymbolLibrarySnapshot | null>;
}

const StorageContext = createContext<SymbolLibraryStorage | null>(null);

export function SymbolLibraryProvider({
	storage,
	children,
}: {
	storage: SymbolLibraryStorage;
	children: ReactNode;
}) {
	return (
		<StorageContext.Provider value={storage}>
			{children}
		</StorageContext.Provider>
	);
}

/** Standalone core consumers can use the editor without choosing a host. */
export function createMemorySymbolLibraryStorage(): SymbolLibraryStorage {
	let library: SymbolLibrary = [];
	return {
		mode: "memory",
		async load() {
			return { symbols: library };
		},
		async save(symbols) {
			library = symbols;
			return "Saved for this editor session.";
		},
	};
}

export function useSymbolLibraryStorage() {
	const storage = useContext(StorageContext);
	const memory = useMemo(createMemorySymbolLibraryStorage, []);
	return storage ?? memory;
}
