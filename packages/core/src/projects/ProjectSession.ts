import type { Circuit, CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import type { CircuitStore } from "@ecad/drawing-core/circuit/store.ts";
import { createProjectSymbolStorage } from "#/projects/project-symbol-storage.ts";
import "#/performance/initialize.ts";
import type { BoardRules } from "@ecad/drawing-core/board/rules.ts";
import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { ModelReference } from "@ecad/drawing-core/footprint/model.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type { Component } from "solid-js";
import type { BoardFile } from "#/board/format.ts";
import type { BoardRulesStore } from "#/board/rules-store.ts";
import type { ViewSelection } from "#/circuit/selection-sync.ts";
import type { SymbolFile } from "#/components/editor/symbolFormat.ts";
import type { FootprintFile } from "#/footprint/format.ts";
import {
	getAppPerformance,
	measurePerformance,
} from "#/performance/runtime.ts";
import { isProjectError, ProjectClosed } from "#/projects/errors.ts";
import type {
	AssetKind,
	ProjectAsset,
	ProjectDrawing,
	ProjectSnapshot,
} from "#/projects/format.ts";
import type { ProjectLinkProps } from "#/projects/ProjectLink.tsx";
import { createProjectAssets } from "#/projects/project-assets.ts";
import { createProjectAutosave } from "#/projects/project-autosave.ts";
import { createProjectEditorFiles } from "#/projects/project-editor-files.ts";
import { createProjectExternalReload } from "#/projects/project-external-reload.ts";
import { createProjectFileActions } from "#/projects/project-file-actions.ts";
import { createProjectSessionState } from "#/projects/project-session-state.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import type { ProjectSettings } from "#/settings/schema.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.ts";

export interface RestoredAssets {
	files: File[];
	problems: string[];
}

export interface ProjectContextValue {
	session: number;
	project: ProjectSnapshot | null;
	LinkComponent?: Component<ProjectLinkProps>;
	selectedAsset: ProjectAsset | null;
	/** `reload` reads the assets again even when the selection is unchanged. */
	selectAsset(asset: ProjectAsset | null, options?: { reload?: boolean }): void;
	store: ReturnType<typeof createDrawingStore>;
	editorSymbol: SymbolDocument | null;
	editorFootprint: FootprintDocument | null;
	editorBoard: BoardDocument | null;
	editorDrawing: DrawingDocument | null;
	editorCircuit: CircuitDocument | null;
	editorViews: EditorViews | null;
	/** Identifies the circuit being opened, or null when none is. */
	openingCircuit: number | null;
	selectEditorFile(path?: string): boolean | Promise<boolean>;
	openCircuit(path: string): Promise<boolean>;
	/** Opens the PCB view of the drawing at `path`. */
	openBoard(path: string): boolean | Promise<boolean>;
	switchEditorView(view: EditorView): Promise<void>;
	preloadEditorViews(): Promise<void>;
	rememberViewSelection(selection: ViewSelection): void;
	takeSelectionHandoff(
		view: ViewSelection["view"],
	): { source: ViewSelection; circuit: Circuit | undefined } | null;
	createCircuit(name: string): Promise<string>;
	importCircuit(file: CircuitFile): Promise<string>;
	mode: ProjectStorage["mode"];
	busy: boolean;
	dirty: boolean;
	error: string;
	conflict: boolean;
	libraryErrors: readonly string[];
	otherUnsavedEdits: boolean;
	reportUnsavedEdits(key: string, unsaved: boolean): void;
	create(name: string): Promise<void>;
	createSymbol(name: string): Promise<string>;
	saveSymbolAttributes(
		id: string,
		attributes: Readonly<Record<string, string>>,
	): Promise<void>;
	/** Creates a footprint file, empty or with a copy of `from`'s description, model and shapes. */
	createFootprint(
		name: string,
		from?: {
			description: string;
			model?: ModelReference;
			shapes: readonly EditorShape[];
		},
	): Promise<string>;
	saveFootprintModel(
		id: string,
		model: ModelReference | undefined,
	): Promise<void>;
	/** Adds an example design's schematic, circuit and board. Resolves to its drawing's path. */
	importExample(
		example: import("#/examples/designs.ts").ExampleDesignId,
	): Promise<string>;
	importSchematic(file: File): Promise<{
		path: string;
		report: import("#/formats/kicad/import.ts").KiCadImportReport;
	}>;
	open(name?: string): Promise<void>;
	reload(): Promise<void>;
	list(): Promise<string[]>;
	save(): Promise<boolean>;
	/** Resolves to the assets the import added to the project. */
	importAssets(
		files: readonly File[],
		kind: AssetKind,
	): Promise<ProjectAsset[]>;
	/**
	 * Reads the stored assets of one kind. Assets over their size limit are
	 * not read; `problems` names each of them, and the others still load.
	 */
	readAssets(kind: AssetKind): Promise<RestoredAssets>;
	saveSettings?(
		change: (settings: ProjectSettings) => ProjectSettings,
	): Promise<void>;
}
export interface CircuitDocument {
	file: CircuitFile;
	store: CircuitStore;
	savedFile: CircuitFile;
	unsubscribe(): void;
}
export interface SymbolDocument {
	file: SymbolFile;
	store: ReturnType<typeof createDrawingStore>;
	savedShapes: EditorShape[];
	unsubscribe(): void;
}
export interface FootprintDocument {
	file: FootprintFile;
	store: ReturnType<typeof createDrawingStore>;
	savedShapes: EditorShape[];
	unsubscribe(): void;
}
export interface BoardDocument {
	file: BoardFile;
	store: ReturnType<typeof createDrawingStore>;
	savedShapes: EditorShape[];
	rules: BoardRulesStore;
	savedRules: BoardRules;
	unsubscribe(): void;
}
export type EditorView = "schematic" | "circuit" | "pcb";
export interface EditorViews {
	circuitId: string;
	schematic: DrawingDocument | "main" | null;
	circuit: CircuitDocument | null;
	board: BoardDocument | null;
}
export interface DrawingDocument {
	file: ProjectDrawing;
	store: ReturnType<typeof createDrawingStore>;
	savedShapes: EditorShape[];
	unsubscribe(): void;
}
export function createProjectSession(
	rawStorage: ProjectStorage,
	symbolStorage: SymbolLibraryStorage,
	LinkComponent?: Component<ProjectLinkProps>,
) {
	const state = createProjectSessionState(rawStorage);
	const {
		listeners,
		storage,
		enqueue,
		linkedAssembler,
		documents,
		setSelectedAsset,
		setStore,
		setEditorCircuit,
		setEditorSymbol,
		setEditorFootprint,
		setEditorBoard,
		setEditorDrawing,
		setEditorViews,
		setEpoch,
		setBusy,
		setDirty,
		setError,
		setLibraryErrors,
		reportUnsavedEdits,
		setHasConflict,
		showError,
		update,
	} = state;
	const { transferAssets, importAssets, readAssets } =
		createProjectAssets(state);
	const { persist, autosave, save } = createProjectAutosave(
		state,
		symbolStorage,
		transferAssets,
	);
	const {
		openCircuit,
		openBoard,
		switchEditorView,
		preloadEditorViews,
		rememberViewSelection,
		takeSelectionHandoff,
		selectEditorFile,
		subscribeMain,
		stopMain,
	} = createProjectEditorFiles(state, autosave, persist);
	const fileActions = createProjectFileActions(state, persist);
	const reloadExternalChanges = createProjectExternalReload(state, autosave);
	const adopt = (snapshot: ProjectSnapshot) => {
		state.editorSelection++;
		state.circuitLayout?.abort();
		state.viewSelection = null;
		state.selectionHandoff = null;
		state.selectionOrigins = new WeakSet();
		linkedAssembler.invalidate();
		documents.clear();
		setEditorCircuit(null);
		setEditorSymbol(null);
		setEditorFootprint(null);
		setEditorBoard(null);
		setEditorDrawing(null);
		setEditorViews(null);
		update(snapshot);
		setSelectedAsset(null);
		state.symbols = snapshot.symbols;
		state.libraries = snapshot.symbolLibraries ?? [];
		const next = measurePerformance(
			"project.adopt",
			() => createDrawingStore(snapshot.shapes, snapshot.pages, snapshot.sheet),
			{ shapes: snapshot.shapes.length },
		);

		setStore(next);
		state.savedMainShapes = next.getSnapshot().shapes;
		subscribeMain();
		setDirty(false);
		state.needsSave = false;
		state.conflict = null;
		setHasConflict(false);
		setLibraryErrors([]);
		state.generation += 1;
		setEpoch(state.generation);
	};

	const switchProject = async (name: string | undefined, creating: boolean) => {
		setBusy(true);
		setError("");
		/** Source assets left out of a new project because of their size. */
		let skipped: string[] = [];
		try {
			await enqueue(async () => {
				if (state.needsSave) await persist();
				const { shapes, pages, sheet } = state.store.getSnapshot();
				const document = {
					shapes,
					...(pages ? { pages } : {}),
					...(sheet ? { sheet } : {}),
					...(state.active?.circuits === undefined
						? {}
						: { circuits: state.active.circuits }),
					...(state.active?.drawings === undefined
						? {}
						: { drawings: state.active.drawings }),
					symbols: state.symbols,
					...(state.active?.footprints === undefined
						? {}
						: { footprints: state.active.footprints }),
					...(state.active?.boards === undefined
						? {}
						: { boards: state.active.boards }),
					symbolLibraries: state.libraries,
				};
				const source = state.active;
				const copying = creating && !!source?.inMemory;
				const assets = copying ? [...state.pendingAssets] : [];
				skipped = [];
				if (copying && source) {
					for (const asset of source.manifest.assets) {
						let bytes: Uint8Array;
						try {
							bytes = await storage.readAsset(source.directory, asset.path);
						} catch (cause) {
							// An asset over its limit cannot be opened, so it is not copied.
							// The original project keeps it.
							if (isProjectError(cause, "ProjectAssetTooLarge")) {
								skipped.push(cause.message);
								continue;
							}
							throw cause;
						}
						assets.push({
							file: new File([new Uint8Array(bytes).buffer], asset.name),
							kind: asset.kind,
						});
					}
				}
				const next = creating
					? await storage.create(name ?? "")
					: await storage.open(name);
				if (!next) {
					skipped = [];
					return;
				}
				if (copying) {
					update(next);
					state.conflict = null;
					setHasConflict(false);
					state.pendingAssets = assets;
					state.symbols = document.symbols;
					state.libraries = document.symbolLibraries;
					state.needsSave = true;
					setDirty(true);
					update(await storage.save(next.directory, document));
					await transferAssets([]);
					adopt(state.active as ProjectSnapshot);
				} else adopt(next);
				state.pendingAssets = [];
			});
			// The session message names each asset the new project left out.
			if (skipped.length)
				setError(
					`The new project leaves out ${skipped.length === 1 ? "an asset" : "assets"} over the size limit, which ${skipped.length === 1 ? "stays" : "stay"} in the original project. ${skipped.join(" ")}`,
				);
		} catch (cause) {
			showError(cause, "Unable to open the project.");
		} finally {
			setBusy(false);
		}
	};

	const createProjectSymbols = (epoch: number) =>
		createProjectSymbolStorage(epoch, {
			storage,
			enqueue,
			persist,
			getSnapshot: () => state.active,
			getGeneration: () => state.generation,
			getSymbols: () => state.symbols,
			getLibraries: () => state.libraries,
			subscribe(listener) {
				state.symbolListeners.add(listener);
				return () => {
					state.symbolListeners.delete(listener);
				};
			},
		});

	const list = () => storage.list();
	const buildValue = (epoch = state.generation): ProjectContextValue => ({
		session: epoch,
		project: state.project,
		LinkComponent,
		selectedAsset: state.selectedAsset,
		selectAsset: (asset, options) => {
			state.editorSelection++;
			setSelectedAsset(asset, options?.reload);
		},
		store: state.store,
		editorSymbol: state.editorSymbol,
		editorFootprint: state.editorFootprint,
		editorBoard: state.editorBoard,
		editorDrawing: state.editorDrawing,
		editorCircuit: state.editorCircuit,
		editorViews: state.editorViews,
		openingCircuit: state.openingCircuit,
		openCircuit,
		openBoard,
		switchEditorView,
		preloadEditorViews,
		rememberViewSelection,
		takeSelectionHandoff,
		selectEditorFile,
		mode: storage.mode,
		busy: state.busy,
		dirty: state.dirty,
		error: state.error,
		conflict: state.hasConflict,
		libraryErrors: state.libraryErrors,
		otherUnsavedEdits: state.unsavedEditors.size > 0,
		reportUnsavedEdits,
		create: (name) => switchProject(name, true),
		...fileActions(epoch),
		open: (name) => switchProject(name, false),
		list,
		reload: async () => {
			setBusy(true);
			try {
				await enqueue(async () => {
					const snapshot =
						(await storage.load()) ?? (await storage.create("Untitled"));
					if (snapshot) adopt(snapshot);
					setError("");
				});
			} catch (cause) {
				setError(errorMessage(cause, "Unable to reload the project."));
			} finally {
				setBusy(false);
			}
		},
		save,
		importAssets: (files, kind) => importAssets(files, kind, epoch),
		readAssets,
		...(storage.saveSettings && {
			saveSettings: (change: (settings: ProjectSettings) => ProjectSettings) =>
				enqueue(async () => {
					const saveSettings = storage.saveSettings;
					const previous = state.active;
					if (!saveSettings || !previous || state.generation !== epoch)
						throw new ProjectClosed();
					if (state.conflict) throw state.conflict;
					try {
						update(
							await saveSettings(
								previous.directory,
								change(previous.manifest.settings ?? {}),
							),
						);
					} catch (cause) {
						state.noteConflict(cause);
						throw cause;
					}
				}),
		}),
	});
	let stableActions: Partial<ProjectContextValue> | undefined;
	let actionEpoch = -1;
	let readAssetSelection: ProjectAsset | null | undefined;
	let readAssetRevision = -1;
	let selectedReadAssets = readAssets;
	return {
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot() {
			if (!state.cached) {
				const next = buildValue();
				if (!stableActions || actionEpoch !== state.epoch) {
					const {
						session: _session,
						project: _project,
						busy: _busy,
						dirty: _dirty,
						error: _error,
						conflict: _conflict,
						libraryErrors: _libraryErrors,
						otherUnsavedEdits: _otherUnsavedEdits,
						store: _store,
						editorSymbol: _editorSymbol,
						editorFootprint: _editorFootprint,
						editorBoard: _editorBoard,
						editorDrawing: _editorDrawing,
						editorCircuit: _editorCircuit,
						editorViews: _editorViews,
						openingCircuit: _openingCircuit,
						selectedAsset: _selectedAsset,
						...actions
					} = next;
					stableActions = actions;
					actionEpoch = state.epoch;
				}
				if (
					readAssetSelection !== state.selectedAsset ||
					readAssetRevision !== state.assetReads
				) {
					readAssetSelection = state.selectedAsset;
					readAssetRevision = state.assetReads;
					selectedReadAssets = (kind) => readAssets(kind);
				}
				state.cached = {
					...next,
					...stableActions,
					readAssets: selectedReadAssets,
				};
			}
			return state.cached;
		},
		getProjectSymbols: createProjectSymbols,
		connect() {
			state.mounted = true;
			const stopLibraries = symbolStorage.subscribe?.(() => {
				linkedAssembler.invalidate();
				state.libraryRevision++;
				if (!state.active) return;
				state.needsSave = true;
				setDirty(true);
				void autosave(true).catch(() => undefined);
			});
			const stopExternalChanges = storage.subscribeExternalChanges?.(
				(directory) => void reloadExternalChanges(directory),
			);
			let cancelled = false;
			const warn = (event: BeforeUnloadEvent) => {
				if (state.dirty || state.project?.inMemory) event.preventDefault();
			};
			globalThis.addEventListener?.("beforeunload", warn);
			void enqueue(async () => {
				try {
					const loaded = await storage.load();
					if (cancelled) return;
					const snapshot = loaded ?? (await storage.create("Untitled"));
					if (snapshot && !cancelled) {
						adopt(snapshot);
					}
				} catch (cause) {
					if (!cancelled)
						setError(errorMessage(cause, "Unable to load the project."));
				} finally {
					if (!cancelled) {
						setBusy(false);
						getAppPerformance()?.appReady();
					}
				}
			});
			return () => {
				cancelled = true;
				stopLibraries?.();
				stopExternalChanges?.();
				linkedAssembler.invalidate();
				state.mounted = false;
				state.circuitLayout?.abort();
				stopMain();
				documents.clear();
				globalThis.removeEventListener?.("beforeunload", warn);
			};
		},
	};
}
export type ProjectSession = ReturnType<typeof createProjectSession>;
