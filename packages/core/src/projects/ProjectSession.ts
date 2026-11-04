import type { CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import type { CircuitStore } from "@ecad/drawing-core/circuit/store.ts";
import { createDocumentRegistry } from "#/projects/document-registry.ts";
import { createLinkedPcbAssembler } from "#/projects/linked-pcb.ts";
import { primaryPcbId } from "#/projects/pcb.ts";
import { projectIndex } from "#/projects/project-index.ts";
import { createProjectSymbolStorage } from "#/projects/project-symbol-storage.ts";
import "#/performance/initialize.ts";
import type { ComponentType } from "react";
import { createDrawingStore } from "#/commands/drawing-store.ts";
import type {
	SymbolFile,
	SymbolLibrary,
} from "#/components/editor/symbolFormat.ts";
import type { EditorShape } from "#/drawing/shapes.ts";
import { symbolFileShapes } from "#/drawing/symbol-file.ts";
import { errorMessage } from "#/lib/error-message.ts";
import { createSerialQueue } from "#/lib/serial-queue.ts";
import { instrumentProjectStorage } from "#/performance/project-storage.ts";
import {
	getAppPerformance,
	measurePerformance,
	measurePerformanceAsync,
} from "#/performance/runtime.ts";
import { isProjectError, type ProjectConflict } from "#/projects/errors.ts";
import {
	type AssetKind,
	type ProjectAsset,
	type ProjectDrawing,
	type ProjectSnapshot,
	projectNameSchema,
} from "#/projects/format.ts";
import type { ProjectLinkProps } from "#/projects/ProjectLink.tsx";
import type { ProjectStorage } from "#/projects/storage.ts";

import type { ConfiguredSymbolLibrary } from "#/symbol-library/config.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.tsx";

export interface ProjectContextValue {
	session: number;
	project: ProjectSnapshot | null;
	LinkComponent?: ComponentType<ProjectLinkProps>;
	selectedAsset: ProjectAsset | null;
	selectAsset(asset: ProjectAsset | null): void;
	store: ReturnType<typeof createDrawingStore>;
	editorSymbol: SymbolDocument | null;
	editorDrawing: DrawingDocument | null;
	editorCircuit: CircuitDocument | null;
	selectEditorFile(path?: string): boolean | Promise<boolean>;
	openCircuit(path: string): Promise<boolean>;
	switchEditorView(view: "circuit" | "schematic"): Promise<void>;
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
	createDrawing(name: string): Promise<string>;
	importSchematic(file: File): Promise<{
		path: string;
		report: import("#/formats/kicad/import.ts").KiCadImportReport;
	}>;
	open(name?: string): Promise<void>;
	reload(): Promise<void>;
	list(): Promise<string[]>;
	save(): Promise<boolean>;
	importAssets(files: readonly File[], kind: AssetKind): Promise<void>;
	readAssets(kind: AssetKind): Promise<File[]>;
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
export interface DrawingDocument {
	file: ProjectDrawing;
	store: ReturnType<typeof createDrawingStore>;
	savedShapes: EditorShape[];
	unsubscribe(): void;
}
export function createProjectSession(
	rawStorage: ProjectStorage,
	symbolStorage: SymbolLibraryStorage,
	LinkComponent?: ComponentType<ProjectLinkProps>,
) {
	const listeners = new Set<() => void>();
	let cached: ProjectContextValue | undefined;
	let notificationPending = false;
	function publish() {
		cached = undefined;
		if (notificationPending) return;
		notificationPending = true;
		queueMicrotask(() => {
			notificationPending = false;
			for (const listener of listeners) listener();
		});
	}

	const storage = instrumentProjectStorage(rawStorage);
	let selectedAsset: ProjectAsset | null = null;
	const setSelectedAsset = (next: ProjectAsset | null) => {
		if (Object.is(next, selectedAsset)) return;
		selectedAsset = next;
		publish();
	};
	let project: ProjectSnapshot | null = null;
	const setProject = (next: ProjectSnapshot | null) => {
		if (Object.is(next, project)) return;
		project = next;
		publish();
	};
	let active: ProjectSnapshot | null = null;
	let store = createDrawingStore();
	const setStore = (next: ReturnType<typeof createDrawingStore>) => {
		if (Object.is(next, store)) return;
		store = next;
		publish();
	};

	const documents = createDocumentRegistry<{
		circuit: CircuitDocument;
		symbol: SymbolDocument;
		drawing: DrawingDocument;
	}>();
	const circuitDocuments = documents.collection("circuit");
	let editorCircuit: CircuitDocument | null = null;
	const setEditorCircuit = (next: CircuitDocument | null) => {
		if (Object.is(next, editorCircuit)) return;
		editorCircuit = next;
		publish();
	};
	const symbolDocuments = documents.collection("symbol");
	const drawingDocuments = documents.collection("drawing");
	let editorSymbol: SymbolDocument | null = null;
	const setEditorSymbol = (next: SymbolDocument | null) => {
		if (Object.is(next, editorSymbol)) return;
		editorSymbol = next;
		publish();
	};
	let editorDrawing: DrawingDocument | null = null;
	const setEditorDrawing = (next: DrawingDocument | null) => {
		if (Object.is(next, editorDrawing)) return;
		editorDrawing = next;
		publish();
	};
	let symbols: SymbolLibrary = [];
	let libraries: readonly ConfiguredSymbolLibrary[] = [];
	let epoch = 0;
	const setEpoch = (next: number) => {
		if (Object.is(next, epoch)) return;
		epoch = next;
		publish();
	};
	let generation = 0;
	let editorSelection = 0;
	let busy = true;
	const setBusy = (next: boolean) => {
		if (Object.is(next, busy)) return;
		busy = next;
		publish();
	};

	let dirty = false;
	const setDirty = (next: boolean) => {
		if (Object.is(next, dirty)) return;
		dirty = next;
		publish();
	};
	let needsSave = false;
	let savedMainShapes = store.getSnapshot().shapes;
	let synchronizing = false;
	let libraryRevision = 0;
	let autosavePending: Promise<void> | undefined;
	let error = "";
	const setError = (next: string) => {
		if (Object.is(next, error)) return;
		error = next;
		publish();
	};
	let libraryErrors: readonly string[] = [];
	const setLibraryErrors = (
		next:
			| readonly string[]
			| ((current: readonly string[]) => readonly string[]),
	) => {
		const value =
			typeof next === "function"
				? (next as (current: typeof libraryErrors) => typeof libraryErrors)(
						libraryErrors,
					)
				: next;
		if (Object.is(value, libraryErrors)) return;
		libraryErrors = value;
		publish();
	};
	let unsavedEditors: ReadonlySet<string> = new Set();
	const setUnsavedEditors = (
		next:
			| ReadonlySet<string>
			| ((current: ReadonlySet<string>) => ReadonlySet<string>),
	) => {
		const value =
			typeof next === "function"
				? (next as (current: typeof unsavedEditors) => typeof unsavedEditors)(
						unsavedEditors,
					)
				: next;
		if (Object.is(value, unsavedEditors)) return;
		unsavedEditors = value;
		publish();
	};
	const reportUnsavedEdits = (key: string, unsaved: boolean) => {
		setUnsavedEditors((current) => {
			if (current.has(key) === unsaved) return current;
			const next = new Set(current);
			if (unsaved) next.add(key);
			else next.delete(key);
			return next;
		});
	};
	let conflict: ProjectConflict | null = null;
	let hasConflict = false;
	const setHasConflict = (next: boolean) => {
		if (Object.is(next, hasConflict)) return;
		hasConflict = next;
		publish();
	};
	let pendingAssets: { file: File; kind: AssetKind }[] = [];
	let mounted = true;

	const enqueue = createSerialQueue();
	const linkedAssembler = createLinkedPcbAssembler();
	const noteConflict = (cause: unknown) => {
		if (!isProjectError(cause, "ProjectConflict")) return;
		conflict = cause;
		if (mounted) setHasConflict(true);
	};
	const showError = (cause: unknown, fallback: string) => {
		if (isProjectError(cause, "ProjectConflict")) noteConflict(cause);
		else setError(errorMessage(cause, fallback));
	};
	const update = (snapshot: ProjectSnapshot) => {
		active = snapshot;
		if (mounted) setProject(snapshot);
	};
	const adopt = (snapshot: ProjectSnapshot) => {
		editorSelection++;
		linkedAssembler.invalidate();
		documents.clear();
		setEditorCircuit(null);
		setEditorSymbol(null);
		setEditorDrawing(null);
		update(snapshot);
		setSelectedAsset(null);
		symbols = snapshot.symbols;
		libraries = snapshot.symbolLibraries ?? [];
		const next = measurePerformance(
			"project.adopt",
			() => createDrawingStore(snapshot.shapes),
			{ shapes: snapshot.shapes.length },
		);

		setStore(next);
		savedMainShapes = next.getSnapshot().shapes;
		subscribeMain();
		setDirty(false);
		needsSave = false;
		conflict = null;
		setHasConflict(false);
		setLibraryErrors([]);
		generation += 1;
		setEpoch(generation);
	};

	const transferAssets = async (files: { file: File; kind: AssetKind }[]) => {
		const previous = active;
		if (!previous) {
			pendingAssets.push(...files);
			return;
		}
		const staged = pendingAssets.length;
		const pending = [...pendingAssets, ...files];
		if (!pending.length) return;
		if (conflict) throw conflict;
		const assets = await Promise.all(
			pending.map(async ({ file, kind }) => ({
				name: file.name,
				kind,
				bytes: new Uint8Array(await file.arrayBuffer()),
			})),
		);
		try {
			update(await storage.importAssets(previous.directory, assets));
		} catch (cause) {
			noteConflict(cause);
			throw cause;
		}
		pendingAssets.splice(0, staged);
	};
	const persist = async (
		nextSymbols?: SymbolLibrary,
		nextLibraries?: readonly ConfiguredSymbolLibrary[],
		nextDrawings?: ProjectDrawing[],
		nextCircuits?: CircuitFile[],
	) => {
		const previous = active;
		const savingLibraryRevision = libraryRevision;
		if (!previous) return;
		if (conflict) throw conflict;
		const edits = [...symbolDocuments.values()].filter(
			(document) =>
				document.store.getSnapshot().shapes !== document.savedShapes,
		);
		const pending = new Map(
			edits.map((document) => [
				document.file.id,
				document.store.getSnapshot().shapes,
			]),
		);
		const mainShapes = store.getSnapshot().shapes;
		const circuitInputs = new Map(
			[...circuitDocuments.values()].map((entry) => [
				entry.file.circuit.id,
				entry.store.getSnapshot().circuit,
			]),
		);
		const drawings = nextDrawings ?? previous.drawings;
		const drawingEdits = new Map(
			[...drawingDocuments.values()].map((entry) => [
				entry.file.id,
				entry.store.getSnapshot().shapes,
			]),
		);
		const circuits = nextCircuits ?? previous.circuits;
		const savedCircuits = circuits?.map((file) => {
			const snapshot = circuitDocuments
				.get(file.circuit.id)
				?.store.getSnapshot();
			return snapshot
				? { circuit: snapshot.circuit, graph: snapshot.graph }
				: file;
		});

		const { assembleProjectSave, withCurrentGraph } = await import(
			"#/projects/save-assembly.ts"
		);
		let document = assembleProjectSave({
			symbols: nextSymbols ?? symbols,
			libraries: nextLibraries ?? libraries,
			pending,
			mainShapes,
			drawings,
			drawingEdits,
			savedCircuits,
		});

		const linked = await linkedAssembler.assemble(
			document,
			previous,
			symbolStorage,
			(errors) => {
				if (mounted)
					setLibraryErrors((current) =>
						current.join("\n") === errors.join("\n") ? current : errors,
					);
			},
		);
		document = {
			...linked.document,
			symbolLibraries: [...linked.document.symbolLibraries],
		};
		const { circuitSources, externalDrawings } = linked;

		let next: ProjectSnapshot;
		try {
			next = await storage.save(previous.directory, document);
		} catch (cause) {
			noteConflict(cause);
			throw cause;
		}
		const refreshDrawing = (
			target: ReturnType<typeof createDrawingStore>,
			shapes: EditorShape[],
			external: boolean,
		) => {
			if (target.getSnapshot().shapes === shapes) return;
			target.transact((current) => [
				undefined,
				{
					...current,
					shapes,
					history: external
						? createDrawingStore(shapes).getSnapshot().history
						: {
								...current.history,
								nodes: {
									...current.history.nodes,
									[current.history.currentId]: {
										...current.history.nodes[current.history.currentId],
										state: { shapes },
									},
								},
							},
					nextShapeId: Math.max(
						current.nextShapeId,
						shapes.reduce((max, shape) => Math.max(max, shape.id), 0) + 1,
					),
				},
			]);
		};
		synchronizing = true;
		if (store.getSnapshot().shapes === mainShapes)
			refreshDrawing(
				store,
				document.shapes,
				externalDrawings.has(primaryPcbId),
			);
		for (const drawing of document.drawings ?? []) {
			const target = drawingDocuments.get(drawing.id);
			if (
				target &&
				target.store.getSnapshot().shapes === drawingEdits.get(drawing.id)
			)
				refreshDrawing(
					target.store,
					drawing.shapes,
					externalDrawings.has(drawing.id),
				);
		}
		const synchronizedCircuits = new Map<string, CircuitFile>();
		for (const file of document.circuits ?? []) {
			const target = circuitDocuments.get(file.circuit.id);
			if (
				target &&
				target.store.getSnapshot().circuit ===
					circuitInputs.get(file.circuit.id) &&
				target.store.getSnapshot().circuit !== file.circuit
			) {
				target.store.synchronize(
					withCurrentGraph(file, target.store.getSnapshot().graph),
					{
						preserveHistory: circuitSources.get(file.circuit.id) === "circuit",
					},
				);
				synchronizedCircuits.set(file.circuit.id, target.store.getSnapshot());
			}
		}

		synchronizing = false;
		savedMainShapes = document.shapes;
		for (const file of document.circuits ?? []) {
			const edit = circuitDocuments.get(file.circuit.id);
			if (edit)
				edit.savedFile = synchronizedCircuits.get(file.circuit.id) ?? file;
		}
		for (const edit of edits) {
			const shapes = pending.get(edit.file.id);
			if (shapes) edit.savedShapes = shapes;
		}
		for (const file of document.drawings ?? []) {
			const edit = drawingDocuments.get(file.id);
			if (edit) edit.savedShapes = file.shapes;
		}
		symbols = document.symbols;
		libraries = document.symbolLibraries;
		linkedAssembler.accept(
			next,
			new Map(
				[...circuitDocuments].map(([id, entry]) => [id, entry.savedFile]),
			),
		);
		update(next);
		if (mounted) {
			needsSave =
				libraryRevision !== savingLibraryRevision ||
				store.getSnapshot().shapes !== savedMainShapes ||
				[...circuitDocuments.values()].some(
					(entry) =>
						entry.store.getSnapshot().circuit !== entry.savedFile.circuit,
				) ||
				[...symbolDocuments.values()].some(
					(entry) => entry.store.getSnapshot().shapes !== entry.savedShapes,
				) ||
				[...drawingDocuments.values()].some(
					(entry) => entry.store.getSnapshot().shapes !== entry.savedShapes,
				);
			setDirty(needsSave);
			setError("");
		}
	};
	const autosave = (onlyIfDirty = false): Promise<void> => {
		if (onlyIfDirty && (conflict || synchronizing)) return Promise.resolve();
		if (autosavePending) return autosavePending;
		const pending = enqueue(async () => {
			if (onlyIfDirty && (!needsSave || conflict)) return;
			do {
				await persist();
				await transferAssets([]);
			} while (needsSave && !conflict && mounted);
		});
		autosavePending = pending
			.catch((cause) => {
				if (mounted && !isProjectError(cause, "ProjectConflict")) {
					needsSave = true;
					setDirty(true);
					showError(cause, "Unable to save the project.");
				}
				throw cause;
			})
			.finally(() => {
				autosavePending = undefined;
			});
		return autosavePending;
	};
	const save = async () => {
		const saveProject = storage.saveProject?.bind(storage);
		if (!saveProject) {
			await autosave();
			return true;
		}
		setBusy(true);
		try {
			return await enqueue(async () => {
				await persist();
				await transferAssets([]);
				const snapshot = active;
				if (!snapshot) return false;
				const saved = await measurePerformanceAsync(
					"project.save-to-disk",
					() => saveProject(snapshot.directory),
				);
				if (saved) update(saved);
				return saved !== null && saved !== undefined;
			});
		} catch (cause) {
			showError(cause, "Unable to save the project.");
			throw cause;
		} finally {
			setBusy(false);
		}
	};
	const openCircuit = async (path: string) => {
		const selectionRequest = ++editorSelection;
		const before = active;
		const circuitId = before
			? projectIndex(before).circuitsByPath.get(path)?.circuit.id
			: undefined;
		const openedGeneration = generation;
		const schematic =
			circuitId === primaryPcbId
				? before?.shapes
				: before && circuitId
					? projectIndex(before).drawingsByCircuit.get(circuitId)?.file.shapes
					: undefined;
		const hasNetSymbols = schematic?.some(
			(shape) => shape.kind === "symbol" && shape.netSymbol,
		);
		if (needsSave || hasNetSymbols) await autosave();
		if (selectionRequest !== editorSelection || openedGeneration !== generation)
			return false;
		const snapshot = active;
		const file =
			snapshot && circuitId
				? projectIndex(snapshot).circuitsById.get(circuitId)?.file
				: undefined;
		if (!file) throw new Error("Circuit file no longer exists.");
		const [{ createCircuitStore }, { createCircuitView }] = await Promise.all([
			import("@ecad/drawing-core/circuit/store.ts"),
			import("@ecad/drawing-core/circuit/untangle.ts"),
		]);
		if (
			openedGeneration !== generation ||
			selectionRequest !== editorSelection ||
			!mounted
		)
			return false;
		const document = documents.openDocument("circuit", file.circuit.id, () => {
			const circuitStore = measurePerformance(
				"editor.open-circuit",
				() =>
					createCircuitStore(
						file.graph.positions.length
							? file
							: createCircuitView(file.circuit),
					),
				{ components: file.circuit.components.length },
			);
			let lastCircuit = circuitStore.getSnapshot().circuit;
			return {
				file,
				store: circuitStore,
				savedFile: circuitStore.getSnapshot(),
				unsubscribe: circuitStore.subscribe(() => {
					const nextCircuit = circuitStore.getSnapshot().circuit;
					if (nextCircuit === lastCircuit) return;
					lastCircuit = nextCircuit;
					if (synchronizing) return;
					needsSave = true;
					setDirty(true);
					void autosave(true).catch(() => undefined);
				}),
			};
		});
		setEditorSymbol(null);
		setEditorDrawing(null);
		setEditorCircuit(document);
		return true;
	};
	const switchEditorView = async (view: "circuit" | "schematic") => {
		const circuitId =
			editorCircuit?.file.circuit.id ??
			editorDrawing?.file.circuitId ??
			primaryPcbId;
		const request = ++editorSelection;
		const openedGeneration = generation;
		try {
			const snapshot = active;
			if (!snapshot) return;
			const hasDrawing =
				circuitId === primaryPcbId ||
				projectIndex(snapshot).drawingsByCircuit.has(circuitId);
			const hasCircuit = projectIndex(snapshot).circuitsById.has(circuitId);
			if (
				needsSave ||
				!hasDrawing ||
				!hasCircuit ||
				(editorDrawing && !editorDrawing.file.circuitId)
			)
				await autosave();
			if (
				request !== editorSelection ||
				openedGeneration !== generation ||
				!mounted
			)
				return;
			const current = active;
			if (!current) return;
			const index = projectIndex(current);
			const selectedCircuitId =
				(editorDrawing
					? index.drawingsById.get(editorDrawing.file.id)?.file.circuitId
					: undefined) ?? circuitId;
			const path =
				view === "circuit"
					? index.circuitsById.get(selectedCircuitId)?.path
					: selectedCircuitId === primaryPcbId
						? current.manifest.drawing
						: index.drawingsByCircuit.get(selectedCircuitId)?.path;
			if (path) {
				if (view === "circuit") await openCircuit(path);
				else selectEditorFile(path);
			}
		} catch (cause) {
			showError(cause, "Unable to switch editor views.");
		}
	};

	const subscribeDrawing = (
		drawingStore: ReturnType<typeof createDrawingStore>,
	) => {
		let lastShapes = drawingStore.getSnapshot().shapes;
		return drawingStore.subscribe(() => {
			const shapes = drawingStore.getSnapshot().shapes;
			if (shapes === lastShapes) return;
			lastShapes = shapes;
			if (synchronizing) return;
			needsSave = true;
			setDirty(true);
			void autosave(true).catch(() => undefined);
		});
	};
	const selectEditorFile = (path?: string): boolean | Promise<boolean> => {
		const selectedSnapshot = active;
		const selectedDrawing = selectedSnapshot
			? projectIndex(selectedSnapshot).drawingsByPath.get(path ?? "")
			: undefined;
		const selectedCircuit = selectedSnapshot
			? projectIndex(selectedSnapshot).circuitsById.get(
					selectedDrawing?.circuitId ??
						(!path || path === selectedSnapshot.manifest.drawing
							? primaryPcbId
							: ""),
				)?.file
			: undefined;
		if (
			needsSave ||
			selectedCircuit?.circuit.components.some(
				(component) => component.schematicShapeId === undefined,
			)
		) {
			const before = active;
			const drawingId = before
				? projectIndex(before).drawingsByPath.get(path ?? "")?.id
				: undefined;
			const symbolId = before
				? projectIndex(before).symbolsByPath.get(path ?? "")?.id
				: undefined;
			const request = ++editorSelection;
			return autosave()
				.then(() => {
					if (request !== editorSelection) return false;
					const current = active;
					return selectEditorFile(
						current
							? drawingId
								? projectIndex(current).drawingsById.get(drawingId)?.path
								: symbolId
									? projectIndex(current).symbolsById.get(symbolId)?.path
									: path === before?.manifest.drawing
										? current.manifest.drawing
										: path
							: path,
					);
				})
				.catch(() => false);
		}
		editorSelection++;
		setEditorCircuit(null);
		const snapshot = active;
		if (!snapshot) return false;
		if (!path || path === snapshot.manifest.drawing) {
			setEditorSymbol(null);
			setEditorDrawing(null);
			return true;
		}
		const drawing = projectIndex(snapshot).drawingsByPath.get(path);
		if (drawing) {
			const document = documents.openDocument("drawing", drawing.id, () => {
				const drawingStore = measurePerformance(
					"editor.open-drawing",
					() => createDrawingStore(drawing.shapes),
					{ shapes: drawing.shapes.length },
				);
				return {
					file: drawing,
					store: drawingStore,
					savedShapes: drawingStore.getSnapshot().shapes,
					unsubscribe: subscribeDrawing(drawingStore),
				};
			});
			setEditorSymbol(null);
			setEditorDrawing(document);
			return true;
		}
		const file = projectIndex(snapshot).symbolsByPath.get(path);
		if (!file) return false;
		const document = documents.openDocument("symbol", file.id, () => {
			const symbolStore = measurePerformance(
				"editor.open-symbol",
				() => createDrawingStore(symbolFileShapes(file)),
				{ shapes: file.shapes.length },
			);
			return {
				file,
				store: symbolStore,
				savedShapes: symbolStore.getSnapshot().shapes,
				unsubscribe: subscribeDrawing(symbolStore),
			};
		});
		setEditorDrawing(null);
		setEditorSymbol(document);
		return true;
	};

	const switchProject = async (name: string | undefined, creating: boolean) => {
		setBusy(true);
		setError("");
		try {
			await enqueue(async () => {
				if (needsSave) await persist();
				const document = {
					shapes: store.getSnapshot().shapes,
					...(active?.circuits === undefined
						? {}
						: { circuits: active.circuits }),
					...(active?.drawings === undefined
						? {}
						: { drawings: active.drawings }),
					symbols: symbols,
					symbolLibraries: libraries,
				};
				const source = active;
				const assets = [...pendingAssets];
				if (creating && source) {
					for (const asset of source.manifest.assets) {
						const bytes = await storage.readAsset(source.directory, asset.path);
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
					conflict = null;
					setHasConflict(false);
					pendingAssets = assets;
					symbols = document.symbols;
					libraries = document.symbolLibraries;
					needsSave = true;
					setDirty(true);
					update(await storage.save(next.directory, document));
					await transferAssets([]);
					adopt(active as ProjectSnapshot);
				} else adopt(next);
				pendingAssets = [];
			});
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
			getSnapshot: () => active,
			getGeneration: () => generation,
			getSymbols: () => symbols,
			getLibraries: () => libraries,
		});

	const importAssets = (
		files: readonly File[],
		kind: AssetKind,
		epoch: number,
	) => {
		const directory = active?.directory;
		return enqueue(() => {
			if (generation !== epoch || directory !== active?.directory)
				throw new Error("The project changed during the import. Try again.");
			return transferAssets(files.map((file) => ({ file, kind })));
		});
	};
	const readAssets = async (kind: AssetKind): Promise<File[]> => {
		const snapshot = active;
		if (!snapshot)
			return pendingAssets
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
					const bytes = await storage.readAsset(snapshot.directory, asset.path);
					return new File([new Uint8Array(bytes).buffer], asset.name);
				}),
		);
	};
	const list = () => storage.list();
	const buildValue = (epoch = generation): ProjectContextValue => ({
		session: epoch,
		project,
		LinkComponent,
		selectedAsset,
		selectAsset: (asset) => {
			editorSelection++;
			setSelectedAsset(asset);
		},
		store,
		editorSymbol,
		editorDrawing,
		editorCircuit,
		openCircuit,
		switchEditorView,
		selectEditorFile,
		mode: storage.mode,
		busy,
		dirty,
		error,
		conflict: hasConflict,
		libraryErrors,
		otherUnsavedEdits: unsavedEditors.size > 0,
		reportUnsavedEdits,
		create: (name) => switchProject(name, true),
		importCircuit: (file) =>
			enqueue(async () => {
				if (!active || generation !== epoch)
					throw new Error("Open a project before importing a circuit.");
				if (
					active.circuits?.some((entry) => entry.circuit.id === file.circuit.id)
				)
					throw new Error(
						"This circuit is already in the project. Open its existing file instead.",
					);
				await persist(undefined, undefined, undefined, [
					...(active.circuits ?? []),
					file,
				]);
				const path = projectIndex(active).circuitsById.get(
					file.circuit.id,
				)?.path;
				if (!path) throw new Error("Unable to open imported circuit.");
				return path;
			}),
		createCircuit: (name) =>
			enqueue(async () => {
				if (!active || generation !== epoch)
					throw new Error("Open a project before creating a circuit.");
				const parsed = projectNameSchema.parse(name);
				const { createCircuit } = await import(
					"@ecad/drawing-core/circuit/model.ts"
				);
				const { uniquePcbName } = await import("#/projects/pcb.ts");
				const file = createCircuit(
					uniquePcbName(parsed, active, active.manifest.name),
				);
				await persist(undefined, undefined, undefined, [
					...(active.circuits ?? []),
					file,
				]);
				const path = projectIndex(active).circuitsById.get(
					file.circuit.id,
				)?.path;
				if (!path) throw new Error("Unable to open the new circuit file.");
				return path;
			}),
		createDrawing: (name) =>
			enqueue(async () => {
				if (!active || generation !== epoch)
					throw new Error("Open a project before creating a drawing.");
				return measurePerformanceAsync("project.create-drawing", async () => {
					const parsedName = projectNameSchema.safeParse(name);
					if (!parsedName.success)
						throw new Error(
							"Use a valid drawing name without slashes or reserved filename characters.",
						);
					name = parsedName.data;
					const drawings = active?.drawings ?? [];
					const stem =
						name
							.normalize("NFKD")
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, "-")
							.replace(/^-|-$/g, "") || "drawing";
					const base = projectNameSchema.safeParse(stem).success
						? stem
						: `drawing-${stem}`;
					let id = base;
					for (
						let suffix = 2;
						drawings.some((drawing) => drawing.id === id);
						suffix++
					)
						id = `${base}-${suffix}`;
					const { uniquePcbName } = await import("#/projects/pcb.ts");
					const current = active;
					if (!current)
						throw new Error("Open a project before creating a drawing.");
					name = uniquePcbName(name, current, current.manifest.name);
					await persist(undefined, undefined, [
						...drawings,
						{ id, name, shapes: [] },
					]);
					const snapshot = active;
					const path = snapshot
						? projectIndex(snapshot).drawingsById.get(id)?.path
						: undefined;
					if (!path) throw new Error("Unable to open the new drawing file.");
					return path;
				});
			}),
		importSchematic: (file) =>
			enqueue(async () => {
				if (!active || generation !== epoch)
					throw new Error("Open a project before importing a schematic.");
				const { parseKiCadFile } = await import("#/formats/parseKiCadFile.ts");
				const result = await measurePerformanceAsync("import.kicad", () =>
					parseKiCadFile(file),
				);
				// Parsing now waits on a worker, so recheck the project it targets.
				if (!active || generation !== epoch)
					throw new Error(
						"The project changed while the schematic was importing.",
					);
				const drawings = active.drawings ?? [];
				let id = "kicad-import";
				for (
					let suffix = 2;
					drawings.some((drawing) => drawing.id === id);
					suffix++
				)
					id = `kicad-import-${suffix}`;
				const name = file.name.replace(/\.kicad_sch$/i, "");
				await persist(undefined, undefined, [
					...drawings,
					{ id, name: projectNameSchema.parse(name), shapes: result.shapes },
				]);
				const path = active
					? projectIndex(active).drawingsById.get(id)?.path
					: undefined;
				if (!path) throw new Error("Unable to open imported drawing.");
				return { path, report: result.report };
			}),

		createSymbol: (name) =>
			enqueue(async () => {
				if (!active || generation !== epoch)
					throw new Error("Open a project before creating a symbol.");
				return measurePerformanceAsync("project.create-symbol", async () => {
					const { createEmptySymbolFile } = await import(
						"#/components/editor/symbolFormat.ts"
					);
					const symbol = createEmptySymbolFile(name, symbols);
					await persist([...symbols, symbol]);
					const snapshot = active;
					const path = snapshot
						? projectIndex(snapshot).symbolsById.get(symbol.id)?.path
						: undefined;
					if (!path) throw new Error("Unable to open the new symbol file.");
					return path;
				});
			}),
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
	});
	let stopMain = () => {};
	const subscribeMain = () => {
		stopMain();
		let lastShapes = store.getSnapshot().shapes;
		stopMain = store.subscribe(() => {
			const shapes = store.getSnapshot().shapes;
			if (shapes === lastShapes) return;
			lastShapes = shapes;
			if (!active || synchronizing) return;
			needsSave = true;
			setDirty(true);
			void autosave(true).catch(() => undefined);
		});
	};

	let stableActions: Partial<ProjectContextValue> | undefined;
	let actionEpoch = -1;
	let readAssetSelection: ProjectAsset | null | undefined;
	let selectedReadAssets = readAssets;
	return {
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot() {
			if (!cached) {
				const next = buildValue();
				if (!stableActions || actionEpoch !== epoch) {
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
						editorDrawing: _editorDrawing,
						editorCircuit: _editorCircuit,
						selectedAsset: _selectedAsset,
						...actions
					} = next;
					stableActions = actions;
					actionEpoch = epoch;
				}
				if (readAssetSelection !== selectedAsset) {
					readAssetSelection = selectedAsset;
					selectedReadAssets = (kind) => readAssets(kind);
				}
				cached = { ...next, ...stableActions, readAssets: selectedReadAssets };
			}
			return cached;
		},
		getProjectSymbols: createProjectSymbols,
		connect() {
			mounted = true;
			const stopLibraries = symbolStorage.subscribe?.(() => {
				linkedAssembler.invalidate();
				libraryRevision++;
				if (!active) return;
				needsSave = true;
				setDirty(true);
				void autosave(true).catch(() => undefined);
			});
			let cancelled = false;
			const warn = (event: BeforeUnloadEvent) => {
				if (dirty || project?.inMemory) event.preventDefault();
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
				linkedAssembler.invalidate();
				mounted = false;
				stopMain();
				documents.clear();
				globalThis.removeEventListener?.("beforeunload", warn);
			};
		},
	};
}
export type ProjectSession = ReturnType<typeof createProjectSession>;
