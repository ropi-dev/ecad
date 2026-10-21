import "#/performance/initialize.ts";
import {
	type ComponentType,
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createDrawingStore } from "#/commands/drawing-store.ts";
import type {
	SymbolFile,
	SymbolLibrary,
} from "#/components/editor/symbolFormat.ts";
import type { EditorShape } from "#/drawing/shapes.ts";
import {
	symbolFileShapes,
	symbolFileWithShapes,
} from "#/drawing/symbol-file.ts";
import { instrumentProjectStorage } from "#/performance/project-storage.ts";
import {
	getAppPerformance,
	measurePerformance,
	measurePerformanceAsync,
} from "#/performance/runtime.ts";
import type {
	AssetKind,
	ProjectAsset,
	ProjectSnapshot,
} from "#/projects/format.ts";
import type { ProjectLinkProps } from "#/projects/ProjectLink.tsx";
import type { ProjectStorage } from "#/projects/storage.ts";
import type {
	ConfiguredSymbolLibrary,
	SymbolLibraryConfig,
} from "#/symbol-library/config.ts";
import {
	SymbolLibraryProvider,
	type SymbolLibraryStorage,
} from "#/symbol-library/storage.tsx";

interface ProjectContextValue {
	project: ProjectSnapshot | null;
	LinkComponent?: ComponentType<ProjectLinkProps>;
	selectAsset(asset: ProjectAsset | null): void;
	store: ReturnType<typeof createDrawingStore>;
	editorSymbol: SymbolDocument | null;
	selectEditorFile(path?: string): void;
	mode: ProjectStorage["mode"];
	busy: boolean;
	dirty: boolean;
	error: string;
	create(name: string): Promise<void>;
	createSymbol(name: string): Promise<string>;
	open(name?: string): Promise<void>;
	reload(): Promise<void>;
	list(): Promise<string[]>;
	save(): Promise<void>;
	importAssets(files: readonly File[], kind: AssetKind): Promise<void>;
	readAssets(kind: AssetKind): Promise<File[]>;
}
interface SymbolDocument {
	file: SymbolFile;
	store: ReturnType<typeof createDrawingStore>;
	savedShapes: EditorShape[];
	unsubscribe(): void;
}
const ProjectContext = createContext<ProjectContextValue | null>(null);
export const useProject = () => useContext(ProjectContext);

export function ProjectProvider({
	storage: rawStorage,
	symbolStorage,
	LinkComponent,
	children,
}: {
	storage: ProjectStorage;
	symbolStorage: SymbolLibraryStorage;
	LinkComponent?: ComponentType<ProjectLinkProps>;
	children: ReactNode;
}) {
	const storage = useMemo(
		() => instrumentProjectStorage(rawStorage),
		[rawStorage],
	);
	const [selectedAsset, setSelectedAsset] = useState<ProjectAsset | null>(null);
	const [project, setProject] = useState<ProjectSnapshot | null>(null);
	const active = useRef<ProjectSnapshot | null>(null);
	const [store, setStore] = useState(() => createDrawingStore());
	const currentStore = useRef(store);
	const symbolDocuments = useRef(new Map<string, SymbolDocument>());
	const [editorSymbol, setEditorSymbol] = useState<SymbolDocument | null>(null);
	const symbols = useRef<SymbolLibrary>([]);
	const libraries = useRef<readonly ConfiguredSymbolLibrary[]>([]);
	const [epoch, setEpoch] = useState(0);
	const generation = useRef(0);
	const [busy, setBusy] = useState(true);
	useEffect(() => {
		if (!busy) getAppPerformance()?.appReady();
	}, [busy]);
	const [dirty, setDirty] = useState(false);
	const needsSave = useRef(false);
	const [error, setError] = useState("");
	const pendingAssets = useRef<{ file: File; kind: AssetKind }[]>([]);
	const operation = useRef<Promise<unknown>>(Promise.resolve());
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const mounted = useRef(true);

	const enqueue = useCallback(<T,>(run: () => Promise<T>): Promise<T> => {
		const next = operation.current.then(run, run);
		operation.current = next.catch(() => undefined);
		return next;
	}, []);
	const update = useCallback((snapshot: ProjectSnapshot) => {
		active.current = snapshot;
		if (mounted.current) setProject(snapshot);
	}, []);
	const adopt = useCallback(
		(snapshot: ProjectSnapshot) => {
			clearTimeout(timer.current);
			for (const document of symbolDocuments.current.values())
				document.unsubscribe();
			symbolDocuments.current.clear();
			setEditorSymbol(null);
			update(snapshot);
			setSelectedAsset(null);
			symbols.current = snapshot.symbols;
			libraries.current = snapshot.symbolLibraries ?? [];
			const next = measurePerformance(
				"project.adopt",
				() => createDrawingStore(snapshot.shapes),
				{ shapes: snapshot.shapes.length },
			);
			currentStore.current = next;
			setStore(next);
			setDirty(false);
			needsSave.current = false;
			generation.current += 1;
			setEpoch(generation.current);
		},
		[update],
	);

	useEffect(() => {
		mounted.current = true;
		let cancelled = false;
		void enqueue(async () => {
			try {
				const snapshot = await storage.load();
				if (snapshot && !cancelled) adopt(snapshot);
			} catch (cause) {
				if (!cancelled)
					setError(
						cause instanceof Error
							? cause.message
							: "Unable to load the project.",
					);
			} finally {
				if (!cancelled) setBusy(false);
			}
		});
		return () => {
			cancelled = true;
			mounted.current = false;
			clearTimeout(timer.current);
			for (const document of symbolDocuments.current.values())
				document.unsubscribe();
		};
	}, [storage, enqueue, adopt]);

	const transferAssets = useCallback(
		async (files: { file: File; kind: AssetKind }[]) => {
			const previous = active.current;
			if (!previous) {
				pendingAssets.current.push(...files);
				return;
			}
			const staged = pendingAssets.current.length;
			const pending = [...pendingAssets.current, ...files];
			if (!pending.length) return;
			const assets = await Promise.all(
				pending.map(async ({ file, kind }) => ({
					name: file.name,
					kind,
					bytes: new Uint8Array(await file.arrayBuffer()),
				})),
			);
			update(await storage.importAssets(previous.directory, assets));
			pendingAssets.current.splice(0, staged);
		},
		[storage, update],
	);
	const persist = useCallback(
		async (
			nextSymbols?: SymbolLibrary,
			nextLibraries?: readonly ConfiguredSymbolLibrary[],
		) => {
			const previous = active.current;
			if (!previous) return;
			const edits = [...symbolDocuments.current.values()].filter(
				(document) =>
					document.store.getSnapshot().shapes !== document.savedShapes,
			);
			const pending = new Map(
				edits.map((document) => [
					document.file.id,
					document.store.getSnapshot().shapes,
				]),
			);
			let savedSymbols = nextSymbols ?? symbols.current;
			if (pending.size) {
				const { parseSymbolFile } = await import(
					"#/components/editor/symbolFormat.ts"
				);
				savedSymbols = savedSymbols.map((symbol) => {
					const shapes = pending.get(symbol.id);
					return shapes
						? parseSymbolFile(
								JSON.stringify(symbolFileWithShapes(symbol, shapes)),
							)
						: symbol;
				});
			}
			const document = {
				shapes: currentStore.current.getSnapshot().shapes,
				symbols: savedSymbols,
				symbolLibraries: (nextLibraries ?? libraries.current).map((library) =>
					library.id === "project-symbols" && library.source.kind === "embedded"
						? {
								...library,
								source: {
									...library.source,
									symbols: savedSymbols,
								},
							}
						: library,
				),
			};
			const next = await storage.save(previous.directory, document);
			for (const edit of edits) {
				const shapes = pending.get(edit.file.id);
				if (shapes) edit.savedShapes = shapes;
			}
			symbols.current = document.symbols;
			libraries.current = document.symbolLibraries;
			update(next);
			if (mounted.current) {
				needsSave.current =
					currentStore.current.getSnapshot().shapes !== document.shapes ||
					[...symbolDocuments.current.values()].some(
						(entry) => entry.store.getSnapshot().shapes !== entry.savedShapes,
					);
				setDirty(needsSave.current);
				setError("");
			}
		},
		[storage, update],
	);
	const save = useCallback(async () => {
		clearTimeout(timer.current);
		try {
			await enqueue(async () => {
				await persist();
				await transferAssets([]);
			});
		} catch (cause) {
			if (mounted.current) {
				needsSave.current = true;
				setDirty(true);
				setError(
					cause instanceof Error
						? cause.message
						: "Unable to save the project.",
				);
			}
			throw cause;
		}
	}, [enqueue, persist, transferAssets]);
	const selectEditorFile = (path?: string) => {
		const snapshot = active.current;
		if (!snapshot || !path || path === snapshot.manifest.drawing) {
			setEditorSymbol(null);
			return;
		}
		const index = snapshot.manifest.symbols.indexOf(path);
		const file = snapshot.symbols[index];
		if (!file) return;
		let document = symbolDocuments.current.get(file.id);
		if (!document) {
			const symbolStore = measurePerformance(
				"editor.open-symbol",
				() => createDrawingStore(symbolFileShapes(file)),
				{ shapes: file.shapes.length },
			);
			document = {
				file,
				store: symbolStore,
				savedShapes: symbolStore.getSnapshot().shapes,
				unsubscribe: symbolStore.subscribe(() => {
					needsSave.current = true;
					setDirty(true);
					clearTimeout(timer.current);
					timer.current = setTimeout(
						() => void save().catch(() => undefined),
						400,
					);
				}),
			};
			symbolDocuments.current.set(file.id, document);
		}
		setEditorSymbol(document);
	};
	useEffect(
		() =>
			store.subscribe(() => {
				if (!active.current) return;
				needsSave.current = true;
				setDirty(true);
				clearTimeout(timer.current);
				timer.current = setTimeout(() => {
					void save().catch(() => undefined);
				}, 400);
			}),
		[store, save],
	);
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (!dirty) return;
			event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);

	const switchProject = useCallback(
		async (name: string | undefined, creating: boolean) => {
			setBusy(true);
			setError("");
			clearTimeout(timer.current);
			try {
				await enqueue(async () => {
					if (needsSave.current) await persist();
					const document = {
						shapes: currentStore.current.getSnapshot().shapes,
						symbols: symbols.current,
						symbolLibraries: libraries.current,
					};
					const source = active.current;
					const assets = [...pendingAssets.current];
					if (creating && source) {
						for (const asset of source.manifest.assets) {
							const bytes = await storage.readAsset(
								source.directory,
								asset.path,
							);
							assets.push({
								file: new File([new Uint8Array(bytes).buffer], asset.name),
								kind: asset.kind,
							});
						}
					}
					const next = creating
						? await storage.create(name ?? "")
						: await storage.open(name);
					if (!next) return;
					if (creating) {
						update(next);
						pendingAssets.current = assets;
						symbols.current = document.symbols;
						libraries.current = document.symbolLibraries;
						needsSave.current = true;
						setDirty(true);
						update(await storage.save(next.directory, document));
						await transferAssets([]);
						adopt(active.current as ProjectSnapshot);
					} else adopt(next);
					pendingAssets.current = [];
				});
			} catch (cause) {
				setError(
					cause instanceof Error
						? cause.message
						: "Unable to open the project.",
				);
			} finally {
				setBusy(false);
			}
		},
		[storage, enqueue, persist, adopt, transferAssets, update],
	);
	const hasProject = project !== null;
	const projectSymbols = useMemo<SymbolLibraryStorage | undefined>(
		() =>
			hasProject
				? {
						mode: storage.mode,
						async canWriteConfiguration() {
							const snapshot = active.current;
							if (!snapshot || generation.current !== epoch) return false;
							return storage.canWriteFile
								? storage.canWriteFile(
										snapshot.directory,
										snapshot.manifest.drawing,
									)
								: true;
						},
						async canEditSymbol(id) {
							const snapshot = active.current;
							if (!snapshot || generation.current !== epoch) return false;
							const index = snapshot.symbols.findIndex(
								(file) => file.id === id,
							);
							const path = snapshot.manifest.symbols[index];
							return path && storage.canWriteFile
								? storage.canWriteFile(snapshot.directory, path)
								: true;
						},
						async load() {
							return enqueue(async () => ({
								symbols: symbols.current,
								directory: active.current?.directory,
							}));
						},
						async save(next) {
							await enqueue(() => {
								if (generation.current !== epoch)
									throw new Error("This project is no longer open.");
								return persist(next);
							});
							return "Saved in this project.";
						},
						async loadConfiguration(): Promise<SymbolLibraryConfig> {
							return enqueue(async () => {
								const configured = [...libraries.current];
								const imported: ConfiguredSymbolLibrary = {
									id: "project-symbols",
									name: "Project symbols",
									enabled: true,
									source: { kind: "embedded", symbols: symbols.current },
								};
								const index = configured.findIndex(
									(library) => library.id === imported.id,
								);
								if (index < 0) {
									if (symbols.current.length || !configured.length)
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
								if (generation.current !== epoch)
									throw new Error("This project is no longer open.");
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
				: undefined,
		[hasProject, storage.mode, storage.canWriteFile, enqueue, persist, epoch],
	);
	const importAssets = useCallback(
		(files: readonly File[], kind: AssetKind) => {
			const directory = active.current?.directory;
			return enqueue(() => {
				if (
					generation.current !== epoch ||
					directory !== active.current?.directory
				)
					throw new Error("The project changed during the import. Try again.");
				return transferAssets(files.map((file) => ({ file, kind })));
			});
		},
		[enqueue, transferAssets, epoch],
	);
	const readAssets = useCallback(
		async (kind: AssetKind): Promise<File[]> => {
			const snapshot = active.current;
			if (!snapshot)
				return pendingAssets.current
					.filter((asset) => asset.kind === kind)
					.map((asset) => asset.file);
			return Promise.all(
				snapshot.manifest.assets
					.filter(
						(asset) =>
							asset.kind === kind &&
							(!selectedAsset ||
								selectedAsset.kind !== kind ||
								asset.path === selectedAsset.path),
					)
					.map(async (asset) => {
						const bytes = await storage.readAsset(
							snapshot.directory,
							asset.path,
						);
						return new File([new Uint8Array(bytes).buffer], asset.name);
					}),
			);
		},
		[storage, selectedAsset],
	);
	const list = useCallback(() => storage.list(), [storage]);
	const value: ProjectContextValue = {
		project,
		LinkComponent,
		selectAsset: setSelectedAsset,
		store,
		editorSymbol,
		selectEditorFile,
		mode: storage.mode,
		busy,
		dirty,
		error,
		create: (name) => switchProject(name, true),
		createSymbol: (name) =>
			enqueue(async () => {
				if (!active.current || generation.current !== epoch)
					throw new Error("Open a project before creating a symbol.");
				return measurePerformanceAsync("project.create-symbol", async () => {
					const { createEmptySymbolFile } = await import(
						"#/components/editor/symbolFormat.ts"
					);
					const symbol = createEmptySymbolFile(name, symbols.current);
					await persist([...symbols.current, symbol]);
					const snapshot = active.current;
					const index =
						snapshot?.symbols.findIndex((entry) => entry.id === symbol.id) ??
						-1;
					const path = snapshot?.manifest.symbols[index];
					if (!path) throw new Error("Unable to open the new symbol file.");
					return path;
				});
			}),
		open: (name) => switchProject(name, false),
		list,
		reload: async () => {
			setBusy(true);
			clearTimeout(timer.current);
			try {
				await enqueue(async () => {
					const snapshot = await storage.load();
					if (snapshot) adopt(snapshot);
					setError("");
				});
			} catch (cause) {
				setError(
					cause instanceof Error
						? cause.message
						: "Unable to reload the project.",
				);
			} finally {
				setBusy(false);
			}
		},
		save,
		importAssets,
		readAssets,
	};
	return (
		<ProjectContext.Provider value={value}>
			<SymbolLibraryProvider
				storage={symbolStorage}
				projectStorage={projectSymbols}
			>
				<div
					key={epoch}
					aria-busy={busy}
					inert={busy}
					className={busy ? "pointer-events-none" : undefined}
				>
					{children}
				</div>
			</SymbolLibraryProvider>
		</ProjectContext.Provider>
	);
}
