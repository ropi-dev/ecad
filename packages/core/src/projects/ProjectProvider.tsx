import type { CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import type { CircuitStore } from "@ecad/drawing-core/circuit/store.ts";
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
import {
	type AssetKind,
	type ProjectAsset,
	type ProjectDrawing,
	type ProjectSnapshot,
	projectNameSchema,
} from "#/projects/format.ts";
import type { ProjectLinkProps } from "#/projects/ProjectLink.tsx";
import type { ProjectStorage } from "#/projects/storage.ts";
import { WorkspaceControlsProvider } from "#/projects/WorkspaceControls.tsx";
import type {
	ConfiguredSymbolLibrary,
	SymbolLibraryConfig,
} from "#/symbol-library/config.ts";
import {
	SymbolLibraryProvider,
	type SymbolLibraryStorage,
} from "#/symbol-library/storage.tsx";

interface ProjectContextValue {
	session: number;
	project: ProjectSnapshot | null;
	LinkComponent?: ComponentType<ProjectLinkProps>;
	selectedAsset: ProjectAsset | null;
	selectAsset(asset: ProjectAsset | null): void;
	store: ReturnType<typeof createDrawingStore>;
	editorSymbol: SymbolDocument | null;
	editorDrawing: DrawingDocument | null;
	editorCircuit: CircuitDocument | null;
	selectEditorFile(path?: string): void;
	openCircuit(path: string): Promise<void>;
	switchEditorView(view: "circuit" | "schematic"): Promise<void>;
	createCircuit(name: string): Promise<string>;
	importCircuit(file: CircuitFile): Promise<string>;
	mode: ProjectStorage["mode"];
	busy: boolean;
	dirty: boolean;
	error: string;
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
interface SymbolDocument {
	file: SymbolFile;
	store: ReturnType<typeof createDrawingStore>;
	savedShapes: EditorShape[];
	unsubscribe(): void;
}
interface DrawingDocument {
	file: ProjectDrawing;
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
	wrapChildren = true,
	children,
}: {
	storage: ProjectStorage;
	symbolStorage: SymbolLibraryStorage;
	LinkComponent?: ComponentType<ProjectLinkProps>;
	wrapChildren?: boolean;
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
	const circuitDocuments = useRef(new Map<string, CircuitDocument>());
	const [editorCircuit, setEditorCircuit] = useState<CircuitDocument | null>(
		null,
	);
	const symbolDocuments = useRef(new Map<string, SymbolDocument>());
	const drawingDocuments = useRef(new Map<string, DrawingDocument>());
	const [editorSymbol, setEditorSymbol] = useState<SymbolDocument | null>(null);
	const [editorDrawing, setEditorDrawing] = useState<DrawingDocument | null>(
		null,
	);
	const symbols = useRef<SymbolLibrary>([]);
	const libraries = useRef<readonly ConfiguredSymbolLibrary[]>([]);
	const [epoch, setEpoch] = useState(0);
	const generation = useRef(0);
	const editorSelection = useRef(0);
	const [busy, setBusy] = useState(true);
	useEffect(() => {
		if (!busy) getAppPerformance()?.appReady();
	}, [busy]);
	const [dirty, setDirty] = useState(false);
	const needsSave = useRef(false);
	const [error, setError] = useState("");
	const pendingAssets = useRef<{ file: File; kind: AssetKind }[]>([]);
	const operation = useRef<Promise<unknown>>(Promise.resolve());
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
			editorSelection.current++;
			for (const document of circuitDocuments.current.values())
				document.unsubscribe();
			circuitDocuments.current.clear();
			setEditorCircuit(null);
			for (const document of symbolDocuments.current.values())
				document.unsubscribe();
			symbolDocuments.current.clear();
			for (const document of drawingDocuments.current.values())
				document.unsubscribe();
			drawingDocuments.current.clear();
			setEditorSymbol(null);
			setEditorDrawing(null);
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
				const loaded = await storage.load();
				if (cancelled) return;
				const snapshot = loaded ?? (await storage.create("Untitled"));
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
			for (const document of circuitDocuments.current.values())
				document.unsubscribe();
			for (const document of symbolDocuments.current.values())
				document.unsubscribe();
			for (const document of drawingDocuments.current.values())
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
			nextDrawings?: ProjectDrawing[],
			nextCircuits?: CircuitFile[],
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
			const mainShapes = currentStore.current.getSnapshot().shapes;
			const circuitInputs = new Map(
				[...circuitDocuments.current.values()].map((entry) => [
					entry.file.circuit.id,
					entry.store.getSnapshot().circuit,
				]),
			);
			const drawings = nextDrawings ?? previous.drawings;
			const drawingEdits = new Map(
				[...drawingDocuments.current.values()].map((entry) => [
					entry.file.id,
					entry.store.getSnapshot().shapes,
				]),
			);
			const circuits = nextCircuits ?? previous.circuits;
			const savedCircuits = circuits?.map((file) => {
				const snapshot = circuitDocuments.current
					.get(file.circuit.id)
					?.store.getSnapshot();
				return snapshot
					? { circuit: snapshot.circuit, graph: snapshot.graph }
					: file;
			});
			let document = {
				...(savedCircuits === undefined ? {} : { circuits: savedCircuits }),
				shapes: mainShapes,
				...(drawings === undefined
					? {}
					: {
							drawings: drawings.map((file) => ({
								...file,
								shapes: drawingEdits.get(file.id) ?? file.shapes,
							})),
						}),
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
			const [
				{ pairPcbDocuments, primaryPcbId },
				{ synchronizePcb },
				{ symbolDefinitions },
				{ libraryDefinitions },
				{ resolveDrawingSymbols },
				{ symbolReferenceKey },
			] = await Promise.all([
				import("#/projects/pcb.ts"),
				import("#/circuit/linked-schematic.ts"),
				import("#/drawing/symbols.ts"),
				import("#/drawing/symbol-file.ts"),
				import("#/drawing/symbol-persistence.ts"),
				import("#/drawing/symbol-reference.ts"),
			]);
			const paired = pairPcbDocuments(document, previous.manifest.name);
			const definitions = [
				...symbolDefinitions,
				...libraryDefinitions(savedSymbols).map((definition) => ({
					...definition,
					library: { scope: "project" as const, id: "project-symbols" },
				})),
			];
			for (const library of document.symbolLibraries) {
				if (library.enabled && library.source.kind === "embedded")
					definitions.push(
						...libraryDefinitions(library.source.symbols).map((definition) => ({
							...definition,
							library: { scope: "project" as const, id: library.id },
						})),
					);
			}
			const { resolveSymbolLibraries } = await import(
				"#/symbol-library/config.ts"
			);
			const userConfig = await symbolStorage.loadConfiguration?.();
			const resolvedLibraries = await resolveSymbolLibraries(
				userConfig?.symbolLibraries ?? [],
				document.symbolLibraries,
				symbolStorage.loadDirectory
					? (path, scope) =>
							symbolStorage.loadDirectory!(path, scope, previous.directory)
					: undefined,
			);
			definitions.push(
				...resolvedLibraries.byReference.values(),
				...resolvedLibraries.definitions,
			);
			const byReference = new Map(
				definitions
					.filter((definition) => definition.library)
					.map((definition) => [
						symbolReferenceKey(definition.library!, definition.id),
						definition,
					]),
			);
			const circuitSources = new Map<string, "circuit" | "schematic">();
			const externalDrawings = new Set<string>();
			for (const file of paired.circuits ?? []) {
				const drawing = paired.drawings?.find(
					(drawing) => drawing.circuitId === file.circuit.id,
				);
				const shapes =
					file.circuit.id === primaryPcbId ? paired.shapes : drawing?.shapes;
				if (!shapes) continue;
				for (const shape of shapes) {
					if (
						shape.kind !== "symbol" ||
						!shape.children.length ||
						!shape.library ||
						byReference.has(
							symbolReferenceKey(shape.library, shape.definitionId),
						)
					)
						continue;
					byReference.set(
						symbolReferenceKey(shape.library, shape.definitionId),
						{
							id: shape.definitionId,
							library: shape.library,
							name: shape.attributes.name,
							prefix: "U",
							value: shape.attributes.value,
							description: "",
							children: shape.children,
							texts: shape.texts,
						},
					);
				}
				const resolved = resolveDrawingSymbols(
					shapes,
					definitions,
					byReference,
				).shapes;
				const cachedSymbols = new Map(
					shapes.flatMap((shape) =>
						shape.kind === "symbol" && shape.children.length
							? [[shape.id, shape] as const]
							: [],
					),
				);
				const linked = synchronizePcb(
					file,
					resolved,
					previous.circuits?.find((old) => old.circuit.id === file.circuit.id),
					definitions,
				);
				linked.shapes = linked.shapes.map((shape) => {
					const cached = cachedSymbols.get(shape.id);
					return shape.kind === "symbol" && cached
						? { ...cached, attributes: shape.attributes }
						: shape;
				});
				circuitSources.set(file.circuit.id, linked.source);
				if (linked.source === "circuit")
					externalDrawings.add(drawing?.id ?? primaryPcbId);
				paired.circuits = paired.circuits!.map((entry) =>
					entry === file ? linked.file : entry,
				);
				if (drawing) drawing.shapes = linked.shapes;
				else paired.shapes = linked.shapes;
			}
			document = {
				...document,
				...paired,
				symbolLibraries: document.symbolLibraries,
			};
			const next = await storage.save(previous.directory, document);
			const refreshDrawing = (
				target: ReturnType<typeof createDrawingStore>,
				shapes: EditorShape[],
				external: boolean,
			) => {
				if (
					JSON.stringify(target.getSnapshot().shapes) === JSON.stringify(shapes)
				)
					return;
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
			if (currentStore.current.getSnapshot().shapes === mainShapes)
				refreshDrawing(
					currentStore.current,
					document.shapes,
					externalDrawings.has(primaryPcbId),
				);
			for (const drawing of document.drawings ?? []) {
				const target = drawingDocuments.current.get(drawing.id);
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
			for (const file of document.circuits ?? []) {
				const target = circuitDocuments.current.get(file.circuit.id);
				if (
					target &&
					target.store.getSnapshot().circuit ===
						circuitInputs.get(file.circuit.id) &&
					JSON.stringify(target.store.getSnapshot().circuit) !==
						JSON.stringify(file.circuit)
				)
					target.store.synchronize(file, {
						preserveHistory: circuitSources.get(file.circuit.id) === "circuit",
					});
			}

			for (const file of document.circuits ?? []) {
				const edit = circuitDocuments.current.get(file.circuit.id);
				if (edit) edit.savedFile = file;
			}
			for (const edit of edits) {
				const shapes = pending.get(edit.file.id);
				if (shapes) edit.savedShapes = shapes;
			}
			for (const file of document.drawings ?? []) {
				const edit = drawingDocuments.current.get(file.id);
				if (edit) edit.savedShapes = file.shapes;
			}
			symbols.current = document.symbols;
			libraries.current = document.symbolLibraries;
			update(next);
			if (mounted.current) {
				needsSave.current =
					JSON.stringify(currentStore.current.getSnapshot().shapes) !==
						JSON.stringify(document.shapes) ||
					[...circuitDocuments.current.values()].some((entry) => {
						const snapshot = entry.store.getSnapshot();
						return (
							JSON.stringify(snapshot.circuit) !==
							JSON.stringify(entry.savedFile.circuit)
						);
					}) ||
					[...symbolDocuments.current.values()].some(
						(entry) =>
							JSON.stringify(entry.store.getSnapshot().shapes) !==
							JSON.stringify(entry.savedShapes),
					) ||
					[...drawingDocuments.current.values()].some(
						(entry) =>
							JSON.stringify(entry.store.getSnapshot().shapes) !==
							JSON.stringify(entry.savedShapes),
					);
				setDirty(needsSave.current);
				setError("");
			}
		},
		[storage, update, symbolStorage],
	);
	const autosave = useCallback(
		async (onlyIfDirty = false) => {
			try {
				await enqueue(async () => {
					if (onlyIfDirty && !needsSave.current) return;
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
		},
		[enqueue, persist, transferAssets],
	);
	useEffect(() => {
		if (
			!project?.circuits?.some((file) => {
				const shapes =
					file.circuit.id === "pcb-main"
						? project.shapes
						: (project.drawings?.find(
								(drawing) => drawing.circuitId === file.circuit.id,
							)?.shapes ?? []);
				return shapes.some(
					(shape) =>
						shape.kind === "text" &&
						shape.electrical === "net" &&
						file.circuit.nets.some(
							(net) =>
								(!net.names.length && shape.text === `N_${net.id}`) ||
								(shape.fontSize === 1 &&
									shape.width === 5 &&
									shape.height === 2 &&
									net.names[0] === shape.text),
						),
				);
			})
		)
			return;
		void autosave().catch(() => undefined);
	}, [project, autosave]);
	const save = useCallback(async () => {
		if (!storage.saveProject) {
			await autosave();
			return true;
		}
		setBusy(true);
		try {
			return await enqueue(async () => {
				await persist();
				await transferAssets([]);
				const snapshot = active.current;
				if (!snapshot) return false;
				const saved = await measurePerformanceAsync(
					"project.save-to-disk",
					() => storage.saveProject!(snapshot.directory),
				);
				if (saved) update(saved);
				return saved !== null && saved !== undefined;
			});
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Unable to save the project.",
			);
			throw cause;
		} finally {
			setBusy(false);
		}
	}, [storage, autosave, enqueue, persist, transferAssets, update]);
	const openCircuit = async (path: string) => {
		const selectionRequest = ++editorSelection.current;
		const before = active.current;
		const circuitId =
			before?.circuits?.[
				before.manifest.circuits?.findIndex(
					(paths) => paths.circuit === path || paths.graph === path,
				) ?? -1
			]?.circuit.id;
		const openedGeneration = generation.current;
		const schematic =
			circuitId === "pcb-main"
				? before?.shapes
				: before?.drawings?.find((drawing) => drawing.circuitId === circuitId)
						?.shapes;
		const hasNetSymbols = schematic?.some(
			(shape) => shape.kind === "symbol" && shape.netSymbol,
		);
		if (needsSave.current || hasNetSymbols) await autosave();
		if (
			selectionRequest !== editorSelection.current ||
			openedGeneration !== generation.current
		)
			return;
		const snapshot = active.current;
		const index =
			snapshot?.manifest.circuits?.findIndex(
				(_paths, index) =>
					snapshot?.circuits?.[index]?.circuit.id === circuitId,
			) ?? -1;
		const file = snapshot?.circuits?.[index];
		if (!file) throw new Error("Circuit file no longer exists.");
		const [{ createCircuitStore }, { createCircuitView }] = await Promise.all([
			import("@ecad/drawing-core/circuit/store.ts"),
			import("@ecad/drawing-core/circuit/untangle.ts"),
		]);
		if (
			openedGeneration !== generation.current ||
			selectionRequest !== editorSelection.current ||
			!mounted.current
		)
			return;
		let document = circuitDocuments.current.get(file.circuit.id);
		if (!document) {
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
			let lastCircuit = JSON.stringify(circuitStore.getSnapshot().circuit);
			document = {
				file,
				store: circuitStore,
				savedFile: circuitStore.getSnapshot(),
				unsubscribe: circuitStore.subscribe(() => {
					const nextCircuit = JSON.stringify(
						circuitStore.getSnapshot().circuit,
					);
					if (nextCircuit === lastCircuit) return;
					lastCircuit = nextCircuit;
					needsSave.current = true;
					setDirty(true);
					void autosave(true).catch(() => undefined);
				}),
			};
			circuitDocuments.current.set(file.circuit.id, document);
		}
		setEditorSymbol(null);
		setEditorDrawing(null);
		setEditorCircuit(document);
	};
	const switchEditorView = async (view: "circuit" | "schematic") => {
		const circuitId =
			editorCircuit?.file.circuit.id ??
			editorDrawing?.file.circuitId ??
			"pcb-main";
		const request = ++editorSelection.current;
		const openedGeneration = generation.current;
		try {
			const snapshot = active.current;
			if (!snapshot) return;
			const hasDrawing =
				circuitId === "pcb-main" ||
				snapshot.drawings?.some((drawing) => drawing.circuitId === circuitId);
			const hasCircuit = snapshot.circuits?.some(
				(file) => file.circuit.id === circuitId,
			);
			if (
				needsSave.current ||
				!hasDrawing ||
				!hasCircuit ||
				(editorDrawing && !editorDrawing.file.circuitId)
			)
				await autosave();
			if (
				request !== editorSelection.current ||
				openedGeneration !== generation.current ||
				!mounted.current
			)
				return;
			const current = active.current;
			if (!current) return;
			const selectedCircuitId =
				current.drawings?.find(
					(drawing) => drawing.id === editorDrawing?.file.id,
				)?.circuitId ?? circuitId;
			if (view === "circuit") {
				const index =
					current.circuits?.findIndex(
						(file) => file.circuit.id === selectedCircuitId,
					) ?? -1;
				const path = current.manifest.circuits?.[index]?.circuit;
				if (path) await openCircuit(path);
			} else {
				const index =
					current.drawings?.findIndex(
						(drawing) => drawing.circuitId === selectedCircuitId,
					) ?? -1;
				const path =
					selectedCircuitId === "pcb-main"
						? current.manifest.drawing
						: current.manifest.drawings?.[index];
				if (path) selectEditorFile(path);
			}
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Unable to switch editor views.",
			);
		}
	};

	const selectEditorFile = (path?: string) => {
		const selectedSnapshot = active.current;
		const selectedDrawing =
			selectedSnapshot?.drawings?.[
				selectedSnapshot.manifest.drawings?.indexOf(path ?? "") ?? -1
			];
		const selectedCircuit = selectedSnapshot?.circuits?.find(
			(file) =>
				file.circuit.id ===
				(selectedDrawing?.circuitId ??
					(!path || path === selectedSnapshot.manifest.drawing
						? "pcb-main"
						: "")),
		);
		if (
			needsSave.current ||
			selectedCircuit?.circuit.components.some(
				(component) => component.schematicShapeId === undefined,
			)
		) {
			const before = active.current;
			const drawingId =
				before?.drawings?.[before.manifest.drawings?.indexOf(path ?? "") ?? -1]
					?.id;
			const symbolId =
				before?.symbols[before.manifest.symbols.indexOf(path ?? "")]?.id;
			const request = ++editorSelection.current;
			void autosave()
				.then(() => {
					if (request !== editorSelection.current) return;
					const current = active.current;
					selectEditorFile(
						drawingId
							? current?.manifest.drawings?.[
									current.drawings?.findIndex(
										(drawing) => drawing.id === drawingId,
									) ?? -1
								]
							: symbolId
								? current?.manifest.symbols[
										current.symbols.findIndex(
											(symbol) => symbol.id === symbolId,
										)
									]
								: path === before?.manifest.drawing
									? current?.manifest.drawing
									: path,
					);
				})
				.catch(() => undefined);
			return;
		}
		editorSelection.current++;
		setEditorCircuit(null);
		const snapshot = active.current;
		if (!snapshot || !path || path === snapshot.manifest.drawing) {
			setEditorSymbol(null);
			setEditorDrawing(null);
			return;
		}
		const drawingIndex = snapshot.manifest.drawings?.indexOf(path) ?? -1;
		const drawing = snapshot.drawings?.[drawingIndex];
		if (drawing) {
			let document = drawingDocuments.current.get(drawing.id);
			if (!document) {
				const drawingStore = measurePerformance(
					"editor.open-drawing",
					() => createDrawingStore(drawing.shapes),
					{ shapes: drawing.shapes.length },
				);
				document = {
					file: drawing,
					store: drawingStore,
					savedShapes: drawingStore.getSnapshot().shapes,
					unsubscribe: drawingStore.subscribe(() => {
						needsSave.current = true;
						setDirty(true);
						void autosave(true).catch(() => undefined);
					}),
				};
				drawingDocuments.current.set(drawing.id, document);
			}
			setEditorSymbol(null);
			setEditorDrawing(document);
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
					void autosave(true).catch(() => undefined);
				}),
			};
			symbolDocuments.current.set(file.id, document);
		}
		setEditorDrawing(null);
		setEditorSymbol(document);
	};
	useEffect(
		() =>
			store.subscribe(() => {
				if (!active.current) return;
				needsSave.current = true;
				setDirty(true);
				void autosave(true).catch(() => undefined);
			}),
		[store, autosave],
	);
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (!dirty && !project?.inMemory) return;
			event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty, project?.inMemory]);

	const switchProject = useCallback(
		async (name: string | undefined, creating: boolean) => {
			setBusy(true);
			setError("");
			try {
				await enqueue(async () => {
					if (needsSave.current) await persist();
					const document = {
						shapes: currentStore.current.getSnapshot().shapes,
						...(active.current?.circuits === undefined
							? {}
							: { circuits: active.current.circuits }),
						...(active.current?.drawings === undefined
							? {}
							: { drawings: active.current.drawings }),
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
		session: epoch,
		project,
		LinkComponent,
		selectedAsset,
		selectAsset: (asset) => {
			editorSelection.current++;
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
		create: (name) => switchProject(name, true),
		importCircuit: (file) =>
			enqueue(async () => {
				if (!active.current || generation.current !== epoch)
					throw new Error("Open a project before importing a circuit.");
				if (
					active.current.circuits?.some(
						(entry) => entry.circuit.id === file.circuit.id,
					)
				)
					throw new Error(
						"This circuit is already in the project. Open its existing file instead.",
					);
				await persist(undefined, undefined, undefined, [
					...(active.current.circuits ?? []),
					file,
				]);
				const index =
					active.current.circuits?.findIndex(
						(entry) => entry.circuit.id === file.circuit.id,
					) ?? -1;
				const path = active.current.manifest.circuits?.[index]?.circuit;
				if (!path) throw new Error("Unable to open imported circuit.");
				return path;
			}),
		createCircuit: (name) =>
			enqueue(async () => {
				if (!active.current || generation.current !== epoch)
					throw new Error("Open a project before creating a circuit.");
				const parsed = projectNameSchema.parse(name);
				const { createCircuit } = await import(
					"@ecad/drawing-core/circuit/model.ts"
				);
				const { uniquePcbName } = await import("#/projects/pcb.ts");
				const file = createCircuit(
					uniquePcbName(parsed, active.current, active.current.manifest.name),
				);
				await persist(undefined, undefined, undefined, [
					...(active.current.circuits ?? []),
					file,
				]);
				const index =
					active.current.circuits?.findIndex(
						(entry) => entry.circuit.id === file.circuit.id,
					) ?? -1;
				const path = active.current.manifest.circuits?.[index]?.circuit;
				if (!path) throw new Error("Unable to open the new circuit file.");
				return path;
			}),
		createDrawing: (name) =>
			enqueue(async () => {
				if (!active.current || generation.current !== epoch)
					throw new Error("Open a project before creating a drawing.");
				return measurePerformanceAsync("project.create-drawing", async () => {
					const parsedName = projectNameSchema.safeParse(name);
					if (!parsedName.success)
						throw new Error(
							"Use a valid drawing name without slashes or reserved filename characters.",
						);
					name = parsedName.data;
					const drawings = active.current?.drawings ?? [];
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
					const current = active.current;
					if (!current)
						throw new Error("Open a project before creating a drawing.");
					name = uniquePcbName(name, current, current.manifest.name);
					await persist(undefined, undefined, [
						...drawings,
						{ id, name, shapes: [] },
					]);
					const snapshot = active.current;
					const index =
						snapshot?.drawings?.findIndex((drawing) => drawing.id === id) ?? -1;
					const path = snapshot?.manifest.drawings?.[index];
					if (!path) throw new Error("Unable to open the new drawing file.");
					return path;
				});
			}),
		importSchematic: (file) =>
			enqueue(async () => {
				if (!active.current || generation.current !== epoch)
					throw new Error("Open a project before importing a schematic.");
				const { importKiCadSchematic } = await import(
					"#/formats/kicad/import.ts"
				);
				const result = importKiCadSchematic(await file.text());
				const drawings = active.current.drawings ?? [];
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
				const index =
					active.current?.drawings?.findIndex((drawing) => drawing.id === id) ??
					-1;
				const path = active.current?.manifest.drawings?.[index];
				if (!path) throw new Error("Unable to open imported drawing.");
				return { path, report: result.report };
			}),

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
			try {
				await enqueue(async () => {
					const snapshot =
						(await storage.load()) ?? (await storage.create("Untitled"));
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
				<WorkspaceControlsProvider>
					{wrapChildren ? (
						<div
							key={epoch}
							aria-busy={busy}
							inert={busy}
							className={busy ? "pointer-events-none" : undefined}
						>
							{children}
						</div>
					) : (
						children
					)}
				</WorkspaceControlsProvider>
			</SymbolLibraryProvider>
		</ProjectContext.Provider>
	);
}
