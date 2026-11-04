import { createContext, type ReactNode, useContext, useMemo } from "react";
import type {
	SymbolFile,
	SymbolLibrary,
} from "#/components/editor/symbolFormat.ts";
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

export interface DirectorySymbolRequest {
	path: string;
	scope: LibraryScope;
	projectDirectory?: string;
	id: string;
}

export interface SymbolEditTarget {
	key: string;
	file: SymbolFile;
	save(file: SymbolFile): Promise<void>;
}

/** Hosts own persistence and file access; the editor owns symbol validation. */
export interface SymbolLibraryStorage {
	mode: "web" | "desktop" | "memory";
	load(): Promise<SymbolLibrarySnapshot>;
	save(symbols: SymbolLibrary, additions: SymbolLibrary): Promise<string>;
	openDirectory?(): Promise<SymbolLibrarySnapshot | null>;
	loadConfiguration?(): Promise<SymbolLibraryConfig>;
	saveConfiguration?(
		config: SymbolLibraryConfig,
		options?: { requirePersistence?: boolean },
	): Promise<string>;
	openLibraryDirectory?(name: string): Promise<ConfiguredSymbolLibrary | null>;
	loadDirectory?(
		path: string,
		scope: LibraryScope,
		projectDirectory?: string,
	): Promise<SymbolLibrary>;
	subscribe?(listener: () => void): () => void;
	canWriteConfiguration?(): Promise<boolean>;
	canEditSymbol?(id: string): Promise<boolean>;
	inspectDirectorySymbol?(request: DirectorySymbolRequest): Promise<{
		file: SymbolFile;
		writable: boolean;
	}>;
	saveDirectorySymbol?(
		request: DirectorySymbolRequest,
		original: SymbolFile,
		next: SymbolFile,
	): Promise<void>;
}

const UpdatesContext = createContext<{
	notify(): void;
	subscribe(listener: () => void): () => void;
} | null>(null);
export const useSymbolLibraryUpdates = () => useContext(UpdatesContext);

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
	const updates = useMemo(() => {
		const listeners = new Set<() => void>();
		return {
			notify() {
				for (const listener of listeners) listener();
			},
			subscribe(listener: () => void) {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		};
	}, []);
	return (
		<UpdatesContext.Provider value={updates}>
			<StorageContext.Provider value={storage}>
				<ProjectStorageContext.Provider value={projectStorage ?? null}>
					{children}
				</ProjectStorageContext.Provider>
			</StorageContext.Provider>
		</UpdatesContext.Provider>
	);
}

/** Standalone core consumers can use the editor without choosing a host. */
export function createMemorySymbolLibraryStorage(): SymbolLibraryStorage {
	const listeners = new Set<() => void>();
	let library: SymbolLibrary = [];
	let config = defaultSymbolConfig();
	return {
		mode: "memory",
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
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
			for (const listener of listeners) listener();
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
			for (const listener of listeners) listener();
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
