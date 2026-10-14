import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { SymbolLibrary } from "#/components/editor/symbolFormat.ts";
import {
	type ConfiguredSymbolLibrary,
	defaultSymbolConfig,
	type LibraryScope,
	parseSymbolConfig,
	type SymbolLibraryConfig,
	serializeSymbolConfig,
} from "#/symbol-library/config.ts";

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
	loadConfiguration?(): Promise<SymbolLibraryConfig>;
	saveConfiguration?(config: SymbolLibraryConfig): Promise<string>;
	openLibraryDirectory?(name: string): Promise<ConfiguredSymbolLibrary | null>;
	loadDirectory?(
		path: string,
		scope: LibraryScope,
		projectDirectory?: string,
	): Promise<SymbolLibrary>;
	subscribe?(listener: () => void): () => void;
}

const StorageContext = createContext<SymbolLibraryStorage | null>(null);
const ProjectStorageContext = createContext<SymbolLibraryStorage | null>(null);

export function SymbolLibraryProvider({
	storage,
	children,
	projectStorage,
}: {
	storage: SymbolLibraryStorage;
	children: ReactNode;
	projectStorage?: SymbolLibraryStorage;
}) {
	return (
		<StorageContext.Provider value={storage}>
			<ProjectStorageContext.Provider value={projectStorage ?? null}>
				{children}
			</ProjectStorageContext.Provider>
		</StorageContext.Provider>
	);
}

/** Standalone core consumers can use the editor without choosing a host. */
export function createMemorySymbolLibraryStorage(): SymbolLibraryStorage {
	let library: SymbolLibrary = [];
	let config = defaultSymbolConfig();
	return {
		mode: "memory",
		async load() {
			return { symbols: library };
		},
		async save(symbols) {
			library = symbols;
			const imported: ConfiguredSymbolLibrary = {
				id: "imported",
				name: "Imported symbols",
				enabled: true,
				source: { kind: "embedded", symbols },
			};
			config = {
				...config,
				symbolLibraries: [
					...config.symbolLibraries.filter((entry) => entry.id !== imported.id),
					imported,
				],
			};
			return "Saved for this editor session.";
		},
		async loadConfiguration() {
			return config;
		},
		async saveConfiguration(next) {
			config = parseSymbolConfig(serializeSymbolConfig(next));
			const imported = config.symbolLibraries.find(
				(entry) => entry.id === "imported",
			);
			library =
				imported?.source.kind === "embedded" ? imported.source.symbols : [];
			return "Saved for this editor session.";
		},
	};
}

export function useProjectSymbolLibraryStorage() {
	return useContext(ProjectStorageContext);
}

export function useSymbolLibraryStorage() {
	const storage = useContext(StorageContext);
	const memory = useMemo(createMemorySymbolLibraryStorage, []);
	return storage ?? memory;
}
