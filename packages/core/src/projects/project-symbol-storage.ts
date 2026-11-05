import type { CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import type { SymbolLibrary } from "#/components/editor/symbolFormat.ts";
import type { SerialQueue } from "#/lib/serial-queue.ts";
import { ProjectClosed } from "#/projects/errors.ts";
import type { ProjectDrawing, ProjectSnapshot } from "#/projects/format.ts";
import { projectIndex } from "#/projects/project-index.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import type {
	ConfiguredSymbolLibrary,
	SymbolLibraryConfig,
} from "#/symbol-library/config.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.tsx";

export function createProjectSymbolStorage(
	epoch: number,
	{
		storage,
		enqueue,
		persist,
		getSnapshot,
		getGeneration,
		getSymbols,
		getLibraries,
		subscribe,
	}: {
		storage: ProjectStorage;
		enqueue: SerialQueue;
		persist(
			symbols?: SymbolLibrary,
			libraries?: readonly ConfiguredSymbolLibrary[],
			drawings?: ProjectDrawing[],
			circuits?: CircuitFile[],
		): Promise<void>;
		getSnapshot(): ProjectSnapshot | null;
		getGeneration(): number;
		getSymbols(): SymbolLibrary;
		getLibraries(): readonly ConfiguredSymbolLibrary[];
		subscribe?(listener: () => void): () => void;
	},
): SymbolLibraryStorage | undefined {
	return getSnapshot() !== null
		? {
				mode: storage.mode,
				subscribe,
				async canWriteConfiguration() {
					const snapshot = getSnapshot();
					if (!snapshot || getGeneration() !== epoch) return false;
					return storage.canWriteFile
						? storage.canWriteFile(
								snapshot.directory,
								snapshot.manifest.drawing,
							)
						: true;
				},
				async canEditSymbol(id) {
					const snapshot = getSnapshot();
					if (!snapshot || getGeneration() !== epoch) return false;
					const path = projectIndex(snapshot).symbolsById.get(id)?.path;
					return path && storage.canWriteFile
						? storage.canWriteFile(snapshot.directory, path)
						: true;
				},
				async load() {
					return enqueue(async () => ({
						symbols: getSymbols(),
						directory: getSnapshot()?.directory,
					}));
				},
				async save(next) {
					await enqueue(() => {
						if (getGeneration() !== epoch) throw new ProjectClosed();
						return persist(next);
					});
					return "Saved in this project.";
				},
				async loadConfiguration(): Promise<SymbolLibraryConfig> {
					return enqueue(async () => {
						const configured = [...getLibraries()];
						const imported: ConfiguredSymbolLibrary = {
							id: "project-symbols",
							name: "Project symbols",
							enabled: true,
							source: { kind: "embedded", symbols: getSymbols() },
						};
						const index = configured.findIndex(
							(library) => library.id === imported.id,
						);
						if (index < 0) {
							if (getSymbols().length || !configured.length)
								configured.unshift(imported);
						} else
							configured[index] = {
								...configured[index],
								source: imported.source,
							};
						return { version: 1, symbolLibraries: configured };
					});
				},
				async saveConfiguration(config) {
					await enqueue(() => {
						if (getGeneration() !== epoch) throw new ProjectClosed();
						const imported = config.symbolLibraries.find(
							(library) => library.id === "project-symbols",
						);
						return persist(
							imported?.source.kind === "embedded"
								? imported.source.symbols
								: [],
							config.symbolLibraries,
						);
					});
					return "Saved in this project.";
				},
			}
		: undefined;
}
