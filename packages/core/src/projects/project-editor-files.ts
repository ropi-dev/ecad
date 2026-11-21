import type { CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	type BoardFile,
	boardCopperLayersInUse,
	createBoardFile,
} from "#/board/format.ts";
import { createBoardRulesStore } from "#/board/rules-store.ts";
import type { ViewSelection } from "#/circuit/selection-sync.ts";
import { symbolFileShapes } from "#/drawing/symbol-file.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import type { ProjectDrawing } from "#/projects/format.ts";
import type {
	BoardDocument,
	CircuitDocument,
	DrawingDocument,
	EditorView,
	EditorViews,
} from "#/projects/ProjectSession.ts";
import { pcbDocumentName, primaryPcbId } from "#/projects/pcb.ts";
import { projectIndex } from "#/projects/project-index.ts";
import {
	editorViewOrder,
	type ProjectSessionState,
} from "#/projects/project-session-state.ts";

/**
 * Chooses the document shown in the editor: the main schematic, another
 * drawing, a project symbol or a circuit graph. Opening a file saves pending
 * edits first when the file's content depends on them. Edits to an open
 * document mark the project dirty and start an autosave.
 */
export function createProjectEditorFiles(
	state: ProjectSessionState,
	autosave: (onlyIfDirty?: boolean) => Promise<void>,
	persist: ReturnType<
		typeof import("#/projects/project-autosave.ts")["createProjectAutosave"]
	>["persist"],
) {
	const {
		documents,
		circuitDocuments,
		boardDocuments,
		drawingDocuments,
		setDirty,
		setEditorCircuit,
		setOpeningCircuit,
		setEditorDrawing,
		setEditorSymbol,
		setEditorFootprint,
		setEditorBoard,
		setEditorViews,
		setSplitViews,
		publishSelection,
		showError,
	} = state;
	const circuitModules = () =>
		Promise.all([
			import("@ecad/drawing-core/circuit/store.ts"),
			import("#/circuit/untangle-client.ts"),
		]);
	type CircuitModules = Awaited<ReturnType<typeof circuitModules>>;
	let layout:
		| {
				circuit: CircuitFile["circuit"];
				controller: AbortController;
				view: Promise<CircuitFile | undefined>;
				opening: boolean;
		  }
		| undefined;
	const laidOut = async (
		circuit: CircuitFile["circuit"],
		[, { untangledCircuitView }]: CircuitModules,
		opening: boolean,
	) => {
		if (layout?.circuit === circuit) {
			layout.opening ||= opening;
			return layout.view;
		}
		if (layout?.opening && !opening) return undefined;
		layout?.controller.abort();
		const controller = new AbortController();
		state.circuitLayout = controller;
		const view = untangledCircuitView(circuit, controller.signal)
			.catch((cause: unknown) => {
				if (controller.signal.aborted) return undefined;
				throw cause;
			})
			.finally(() => {
				if (layout?.controller !== controller) return;
				layout = undefined;
				state.circuitLayout = undefined;
			});
		view.catch(() => undefined);
		layout = { circuit, controller, view, opening };
		return view;
	};
	const openCircuitDocument = (
		file: CircuitFile,
		view: CircuitFile,
		[{ createCircuitStore }]: CircuitModules,
	) =>
		documents.openDocument("circuit", file.circuit.id, () => {
			const circuitStore = measurePerformance(
				"editor.open-circuit",
				() => createCircuitStore(view),
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
					if (state.synchronizing) return;
					state.needsSave = true;
					setDirty(true);
					void autosave(true).catch(() => undefined);
				}),
			};
		});
	const needsLayout = (file: CircuitFile) =>
		!file.graph.positions.length &&
		!documents.collection("circuit").has(file.circuit.id);
	const clearEditors = (
		keep?: "symbol" | "footprint" | "board" | "drawing" | "circuit",
	) => {
		if (keep !== "symbol") setEditorSymbol(null);
		if (keep !== "footprint") setEditorFootprint(null);
		if (keep !== "board") setEditorBoard(null);
		if (keep !== "drawing") setEditorDrawing(null);
		if (keep !== "circuit") setEditorCircuit(null);
	};
	let opening:
		| {
				path: string;
				request: number;
				generation: number;
				opened: Promise<boolean>;
		  }
		| undefined;
	const openCircuit = (path: string) => {
		if (
			opening?.path === path &&
			opening.request === state.editorSelection &&
			opening.generation === state.generation
		)
			return opening.opened;
		const selectionRequest = ++state.editorSelection;
		// The editor waits for this circuit instead of showing the schematic.
		setOpeningCircuit(selectionRequest);
		const opened = loadCircuit(path, selectionRequest).finally(() => {
			if (opening?.request === selectionRequest) opening = undefined;
			if (state.openingCircuit === selectionRequest) setOpeningCircuit(null);
		});
		opening = {
			path,
			request: selectionRequest,
			generation: state.generation,
			opened,
		};
		return opened;
	};
	const loadCircuit = async (path: string, selectionRequest: number) => {
		const before = state.active;
		const circuitId = before
			? projectIndex(before).circuitsByPath.get(path)?.circuit.id
			: undefined;
		const openedGeneration = state.generation;
		const schematic =
			circuitId === primaryPcbId
				? before?.shapes
				: before && circuitId
					? projectIndex(before).drawingsByCircuit.get(circuitId)?.file.shapes
					: undefined;
		const hasNetSymbols = schematic?.some(
			(shape) => shape.kind === "symbol" && shape.netSymbol,
		);
		if (state.needsSave || hasNetSymbols) await autosave();
		if (
			selectionRequest !== state.editorSelection ||
			openedGeneration !== state.generation
		)
			return false;
		const modules = await circuitModules();
		const stale = () =>
			openedGeneration !== state.generation ||
			selectionRequest !== state.editorSelection ||
			!state.mounted;
		if (stale()) return false;
		// Read the file after each wait, which a reload from disk may span.
		const read = () => {
			const snapshot = state.active;
			return snapshot && circuitId
				? projectIndex(snapshot).circuitsById.get(circuitId)?.file
				: undefined;
		};
		let file = read();
		let view = file;
		while (file && needsLayout(file)) {
			const { circuit } = file;
			const arranged = await laidOut(circuit, modules, true);
			if (!arranged || stale()) return false;
			file = read();
			view = file;
			if (file?.circuit !== circuit) continue;
			if (!file.graph.positions.length) view = arranged;
			break;
		}
		if (!file || !view) throw new Error("Circuit file no longer exists.");
		const document = openCircuitDocument(file, view, modules);
		clearEditors("circuit");
		setEditorCircuit(document);
		return true;
	};
	const ensureBoard = async (circuitId: string) => {
		const snapshot = state.active;
		if (!snapshot) return undefined;
		const index = projectIndex(snapshot);
		const existing = index.boardsByCircuit.get(circuitId)?.path;
		if (existing) return existing;
		const circuit = index.circuitsById.get(circuitId)?.file.circuit;
		if (!circuit) return undefined;
		await persist(undefined, undefined, undefined, undefined, undefined, [
			...(snapshot.boards ?? []),
			createBoardFile(pcbDocumentName(circuit.name), circuitId),
		]);
		const current = state.active;
		return current
			? projectIndex(current).boardsByCircuit.get(circuitId)?.path
			: undefined;
	};
	const applyPrimaryView = (view: EditorView, views: EditorViews) => {
		if (view === "circuit" && views.circuit) {
			clearEditors("circuit");
			setEditorCircuit(views.circuit);
		} else if (view === "pcb" && views.board) {
			clearEditors("board");
			setEditorBoard(views.board);
		} else if (views.schematic) {
			if (views.schematic === "main") clearEditors();
			else {
				clearEditors("drawing");
				setEditorDrawing(views.schematic);
			}
		}
	};
	const switchEditorView = async (view: EditorView) => {
		const circuitId =
			state.editorBoard?.file.circuitId ??
			state.editorCircuit?.file.circuit.id ??
			state.editorDrawing?.file.circuitId ??
			primaryPcbId;
		const request = ++state.editorSelection;
		const openedGeneration = state.generation;
		try {
			const snapshot = state.active;
			if (!snapshot) return;
			const hasDrawing =
				circuitId === primaryPcbId ||
				projectIndex(snapshot).drawingsByCircuit.has(circuitId);
			const hasCircuit = projectIndex(snapshot).circuitsById.has(circuitId);
			if (
				state.needsSave ||
				!hasDrawing ||
				!hasCircuit ||
				(state.editorDrawing && !state.editorDrawing.file.circuitId)
			)
				await autosave();
			if (
				request !== state.editorSelection ||
				openedGeneration !== state.generation ||
				!state.mounted
			)
				return;
			const current = state.active;
			if (!current) return;
			const index = projectIndex(current);
			const selectedCircuitId =
				(state.editorDrawing
					? index.drawingsById.get(state.editorDrawing.file.id)?.file.circuitId
					: undefined) ?? circuitId;
			const path =
				view === "pcb"
					? await state.enqueue(() => ensureBoard(selectedCircuitId))
					: view === "circuit"
						? index.circuitsById.get(selectedCircuitId)?.path
						: selectedCircuitId === primaryPcbId
							? current.manifest.drawing
							: index.drawingsByCircuit.get(selectedCircuitId)?.path;
			if (
				request !== state.editorSelection ||
				openedGeneration !== state.generation ||
				!state.mounted
			)
				return;
			if (!path) return;
			const remembered = state.viewSelection;
			const currentStore =
				state.editorCircuit?.store ??
				state.editorBoard?.store ??
				state.editorDrawing?.store ??
				state.store;
			const synced =
				state.syncedSelection &&
				state.syncedSelection.circuitId === selectedCircuitId &&
				state.syncedSelection.generation === state.generation
					? state.syncedSelection.source
					: undefined;
			const handoffSource =
				remembered && remembered.store === currentStore
					? (remembered.origin ?? remembered)
					: synced;
			const handoff = handoffSource
				? {
						view,
						circuitId: selectedCircuitId,
						generation: state.generation,
						source: handoffSource,
					}
				: null;
			const wasSplitShown = state.splitViews.includes(view);
			keepOpenViews();
			setSplitViews([]);
			state.selectionHandoff = wasSplitShown ? null : handoff;
			const opened =
				view === "circuit"
					? await openCircuit(path)
					: view === "pcb"
						? await openBoard(path)
						: await selectEditorFile(path);
			if (!opened && state.selectionHandoff === handoff)
				state.selectionHandoff = null;
		} catch (cause) {
			state.selectionHandoff = null;
			showError(cause, "Unable to switch editor views.");
		}
	};
	const setSplitEditorViews = async (
		views: readonly EditorView[],
		focus?: EditorView,
	) => {
		const wanted = editorViewOrder.filter((view) => views.includes(view));
		if (!wanted.length) return;
		const currentView: EditorView = state.editorCircuit
			? "circuit"
			: state.editorBoard
				? "pcb"
				: "schematic";
		if (wanted.length === 1) {
			if (wanted[0] === currentView) {
				state.editorSelection++;
				setSplitViews([]);
				return;
			}
			await switchEditorView(wanted[0]);
			return;
		}
		if (!state.active || state.editorSymbol || state.editorFootprint) return;
		const circuitId =
			state.editorBoard?.file.circuitId ??
			state.editorCircuit?.file.circuit.id ??
			state.editorDrawing?.file.circuitId ??
			primaryPcbId;
		const request = ++state.editorSelection;
		const openedGeneration = state.generation;
		const stale = () =>
			request !== state.editorSelection ||
			openedGeneration !== state.generation ||
			!state.mounted;
		try {
			const snapshot = state.active;
			if (!snapshot) return;
			const indexBefore = projectIndex(snapshot);
			const hasDrawing =
				circuitId === primaryPcbId
					? snapshot.manifest.drawing !== undefined
					: indexBefore.drawingsByCircuit.has(circuitId);
			const hasCircuit = indexBefore.circuitsById.has(circuitId);
			const schematicShapes =
				circuitId === primaryPcbId
					? snapshot.shapes
					: indexBefore.drawingsByCircuit.get(circuitId)?.file.shapes;
			const hasNetSymbols = schematicShapes?.some(
				(shape) => shape.kind === "symbol" && shape.netSymbol,
			);
			if (
				state.needsSave ||
				!hasDrawing ||
				!hasCircuit ||
				(state.editorDrawing && !state.editorDrawing.file.circuitId) ||
				(wanted.includes("circuit") && hasNetSymbols)
			)
				await autosave();
			if (stale() || !state.active) return;
			const current = state.active;
			const index = projectIndex(current);
			const selectedCircuitId =
				(state.editorDrawing
					? index.drawingsById.get(state.editorDrawing.file.id)?.file.circuitId
					: undefined) ?? circuitId;
			const kept =
				state.editorViews?.circuitId === selectedCircuitId
					? state.editorViews
					: {
							circuitId: selectedCircuitId,
							schematic: null,
							circuit: null,
							board: null,
						};
			let schematicDoc: DrawingDocument | "main" | null =
				kept.schematic ??
				(state.editorCircuit || state.editorBoard
					? null
					: (state.editorDrawing ??
						(current.manifest.drawing !== undefined ? "main" : null)));
			if (wanted.includes("schematic")) {
				if (selectedCircuitId === primaryPcbId)
					schematicDoc = current.manifest.drawing !== undefined ? "main" : null;
				else {
					const drawing = index.drawingsByCircuit.get(selectedCircuitId)?.file;
					schematicDoc = drawing ? openDrawingDocument(drawing) : null;
				}
			}
			let circuitDoc: CircuitDocument | null =
				kept.circuit ?? circuitDocuments.get(selectedCircuitId) ?? null;
			if (wanted.includes("circuit") && !circuitDoc) {
				const modules = await circuitModules();
				if (stale()) return;
				const readCircuit = () =>
					state.active
						? projectIndex(state.active).circuitsById.get(selectedCircuitId)
								?.file
						: undefined;
				let file = readCircuit();
				let view = file;
				while (file && needsLayout(file)) {
					const { circuit } = file;
					const arranged = await laidOut(circuit, modules, true);
					if (!arranged || stale()) return;
					file = readCircuit();
					view = file;
					if (file?.circuit !== circuit) continue;
					if (!file.graph.positions.length) view = arranged;
					break;
				}
				if (file && view) circuitDoc = openCircuitDocument(file, view, modules);
			}
			let boardDoc: BoardDocument | null =
				kept.board ?? boardDocuments.get(selectedCircuitId) ?? null;
			if (wanted.includes("pcb")) {
				const boardPath = await state.enqueue(() =>
					ensureBoard(selectedCircuitId),
				);
				if (stale() || !state.active) return;
				const boardFile = boardPath
					? projectIndex(state.active).boardsByPath.get(boardPath)
					: undefined;
				if (boardFile) {
					const alreadyVisible =
						state.editorBoard?.file.circuitId === selectedCircuitId ||
						state.splitViews.includes("pcb");
					boardDoc = openBoardDocument(boardFile);
					if (!alreadyVisible) {
						try {
							const { announceBoardSync, boardContext, synchronizeBoardStore } =
								await import("#/board/sync-document.ts");
							announceBoardSync(
								await synchronizeBoardStore(
									boardDoc.store,
									boardContext(state.active, boardFile.circuitId),
								),
							);
						} catch (cause) {
							showError(
								cause,
								"Unable to update the board from its schematic.",
							);
						}
						if (stale()) return;
					}
				}
			}
			const nextViews: EditorViews = {
				circuitId: selectedCircuitId,
				schematic: schematicDoc,
				circuit: circuitDoc,
				board: boardDoc,
			};
			setEditorViews(nextViews);
			const available = wanted.filter((view) =>
				view === "schematic"
					? nextViews.schematic !== null
					: view === "circuit"
						? nextViews.circuit !== null
						: nextViews.board !== null,
			);
			if (!available.length) return;
			const primary =
				focus && available.includes(focus)
					? focus
					: available.includes(currentView)
						? currentView
						: available[0];
			applyPrimaryView(primary, nextViews);
			setSplitViews(available.length >= 2 ? available : []);
		} catch (cause) {
			showError(cause, "Unable to open split view.");
		}
	};
	const focusSplitView = (view: EditorView) => {
		if (!state.splitViews.includes(view) || !state.editorViews) return;
		applyPrimaryView(view, state.editorViews);
	};
	const circuitIdForView = (view: EditorView, store: object) => {
		if (view === "circuit") {
			for (const [id, entry] of circuitDocuments)
				if (entry.store === store) return id;
			return undefined;
		}
		if (view === "pcb") {
			for (const [id, entry] of boardDocuments)
				if (entry.store === store) return id;
			return undefined;
		}
		if (store === state.store)
			return state.active?.manifest.drawing !== undefined
				? primaryPcbId
				: undefined;
		for (const [id, entry] of drawingDocuments)
			if (entry.store === store)
				return (
					(state.active
						? projectIndex(state.active).drawingsById.get(id)?.file.circuitId
						: undefined) ?? entry.file.circuitId
				);
		return undefined;
	};
	const circuitForViewSelection = (circuitId: string) =>
		circuitDocuments.get(circuitId)?.store.getSnapshot().circuit ??
		(state.active
			? projectIndex(state.active).circuitsById.get(circuitId)?.file.circuit
			: undefined);
	const subscribeViewSelection = (listener: () => void) => {
		state.selectionListeners.add(listener);
		return () => {
			state.selectionListeners.delete(listener);
		};
	};
	const getViewSelection = () => state.syncedSelection;
	const rememberViewSelection = (selection: ViewSelection) => {
		const { origin, ...current } = selection;
		state.viewSelection =
			!origin || state.selectionOrigins.has(origin) ? selection : current;
		if (!origin) {
			const circuitId = circuitIdForView(selection.view, selection.store);
			if (circuitId) {
				state.syncedSelection = {
					version: ++state.selectionVersion,
					circuitId,
					generation: state.generation,
					source: selection,
				};
				publishSelection();
			}
		}
	};
	const takeSelectionHandoff = (view: ViewSelection["view"]) => {
		const handoff = state.selectionHandoff;
		state.selectionHandoff = null;
		const snapshot = state.active;
		if (
			!handoff ||
			!snapshot ||
			handoff.view !== view ||
			handoff.generation !== state.generation
		)
			return null;
		const circuitId =
			view === "circuit"
				? state.editorCircuit?.file.circuit.id
				: view === "pcb"
					? state.editorBoard?.file.circuitId
					: state.editorCircuit ||
							state.editorSymbol ||
							state.editorFootprint ||
							state.editorBoard
						? undefined
						: state.editorDrawing
							? projectIndex(snapshot).drawingsById.get(
									state.editorDrawing.file.id,
								)?.file.circuitId
							: primaryPcbId;
		if (circuitId !== handoff.circuitId) return null;
		state.selectionOrigins.add(handoff.source);
		return {
			source: handoff.source,
			circuit:
				circuitDocuments.get(circuitId)?.store.getSnapshot().circuit ??
				projectIndex(snapshot).circuitsById.get(circuitId)?.file.circuit,
		};
	};

	const subscribeDrawing = (
		drawingStore: ReturnType<typeof createDrawingStore>,
	) => {
		let lastShapes = drawingStore.getSnapshot().shapes;
		return drawingStore.subscribe(() => {
			const shapes = drawingStore.getSnapshot().shapes;
			if (shapes === lastShapes) return;
			lastShapes = shapes;
			if (state.synchronizing) return;
			state.needsSave = true;
			setDirty(true);
			void autosave(true).catch(() => undefined);
		});
	};
	const openBoardDocument = (board: BoardFile) =>
		documents.openDocument("board", board.circuitId, () => {
			const boardStore = measurePerformance(
				"editor.open-board",
				() => createDrawingStore(board.shapes),
				{ shapes: board.shapes.length },
			);
			const rules = createBoardRulesStore(board.rules);
			const stopLayers = boardStore.subscribe(() => {
				const needed = boardCopperLayersInUse(boardStore.getSnapshot().shapes);
				const current = rules.get();
				if (needed > current.copperLayers)
					rules.set({ ...current, copperLayers: needed });
			});
			const stopShapes = subscribeDrawing(boardStore);
			const stopRules = rules.subscribe(() => {
				if (state.synchronizing) return;
				state.needsSave = true;
				setDirty(true);
				void autosave(true).catch(() => undefined);
			});
			return {
				file: board,
				store: boardStore,
				savedShapes: boardStore.getSnapshot().shapes,
				rules,
				savedRules: board.rules,
				unsubscribe: () => {
					stopLayers();
					stopShapes();
					stopRules();
				},
			};
		});
	const openDrawingDocument = (drawing: ProjectDrawing) =>
		documents.openDocument("drawing", drawing.id, () => {
			const drawingStore = measurePerformance(
				"editor.open-drawing",
				() => createDrawingStore(drawing.shapes, drawing.pages, drawing.sheet),
				{ shapes: drawing.shapes.length },
			);
			return {
				file: drawing,
				store: drawingStore,
				savedShapes: drawingStore.getSnapshot().shapes,
				unsubscribe: subscribeDrawing(drawingStore),
			};
		});
	const openBoard = (path: string): boolean | Promise<boolean> => {
		if (state.needsSave) {
			const before = state.active;
			const circuitId = before
				? projectIndex(before).boardsByPath.get(path)?.circuitId
				: undefined;
			const request = ++state.editorSelection;
			return autosave()
				.then(() => {
					if (request !== state.editorSelection) return false;
					const current = state.active;
					const next =
						current && circuitId
							? projectIndex(current).boardsByCircuit.get(circuitId)?.path
							: undefined;
					return next ? openBoard(next) : false;
				})
				.catch(() => false);
		}
		const snapshot = state.active;
		const board = snapshot
			? projectIndex(snapshot).boardsByPath.get(path)
			: undefined;
		if (!board) return false;
		const document = openBoardDocument(board);
		const request = ++state.editorSelection;
		const show = () => {
			if (request !== state.editorSelection) return false;
			clearEditors("board");
			setEditorBoard(document);
			return true;
		};
		return import("#/board/sync-document.ts")
			.then(
				async ({ announceBoardSync, boardContext, synchronizeBoardStore }) =>
					announceBoardSync(
						await synchronizeBoardStore(
							document.store,
							boardContext(state.active, board.circuitId),
						),
					),
			)
			.then(show, (cause) => {
				showError(cause, "Unable to update the board from its schematic.");
				return show();
			});
	};
	const selectEditorFile = (path?: string): boolean | Promise<boolean> => {
		const selectedSnapshot = state.active;
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
			state.needsSave ||
			selectedCircuit?.circuit.components.some(
				(component) => component.schematicShapeId === undefined,
			)
		) {
			const before = state.active;
			const drawingId = before
				? projectIndex(before).drawingsByPath.get(path ?? "")?.id
				: undefined;
			const symbolId = before
				? projectIndex(before).symbolsByPath.get(path ?? "")?.id
				: undefined;
			const footprintId = before
				? projectIndex(before).footprintsByPath.get(path ?? "")?.id
				: undefined;
			const request = ++state.editorSelection;
			return autosave()
				.then(() => {
					if (request !== state.editorSelection) return false;
					const current = state.active;
					return selectEditorFile(
						current
							? drawingId
								? projectIndex(current).drawingsById.get(drawingId)?.path
								: symbolId
									? projectIndex(current).symbolsById.get(symbolId)?.path
									: footprintId
										? projectIndex(current).footprintsById.get(footprintId)
												?.path
										: path === before?.manifest.drawing
											? current.manifest.drawing
											: path
							: path,
					);
				})
				.catch(() => false);
		}
		state.editorSelection++;
		setEditorCircuit(null);
		const snapshot = state.active;
		if (!snapshot) return false;
		if (!path || path === snapshot.manifest.drawing) {
			clearEditors("circuit");
			return true;
		}
		const drawing = projectIndex(snapshot).drawingsByPath.get(path);
		if (drawing) {
			const document = openDrawingDocument(drawing);
			clearEditors("drawing");
			setEditorDrawing(document);
			return true;
		}
		const footprint = projectIndex(snapshot).footprintsByPath.get(path);
		if (footprint) {
			const document = documents.openDocument("footprint", footprint.id, () => {
				const footprintStore = measurePerformance(
					"editor.open-footprint",
					() => createDrawingStore(footprint.shapes),
					{ shapes: footprint.shapes.length },
				);
				return {
					file: footprint,
					store: footprintStore,
					savedShapes: footprintStore.getSnapshot().shapes,
					unsubscribe: subscribeDrawing(footprintStore),
				};
			});
			clearEditors("footprint");
			setEditorFootprint(document);
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
		clearEditors("symbol");
		setEditorSymbol(document);
		return true;
	};

	const currentCircuitId = () => {
		const snapshot = state.active;
		if (!snapshot || state.editorSymbol || state.editorFootprint) return;
		const index = projectIndex(snapshot);
		const circuitId =
			state.editorCircuit?.file.circuit.id ??
			state.editorBoard?.file.circuitId ??
			(state.editorDrawing
				? index.drawingsById.get(state.editorDrawing.file.id)?.file.circuitId
				: snapshot.manifest.drawing === undefined
					? undefined
					: primaryPcbId);
		return circuitId && index.circuitsById.has(circuitId)
			? circuitId
			: undefined;
	};
	const keepOpenViews = () => {
		const circuitId = currentCircuitId();
		if (!circuitId) return;
		const kept =
			state.editorViews?.circuitId === circuitId
				? state.editorViews
				: { circuitId, schematic: null, circuit: null, board: null };
		setEditorViews({
			...kept,
			schematic:
				state.editorCircuit || state.editorBoard
					? kept.schematic
					: (state.editorDrawing ?? "main"),
			circuit: state.editorCircuit ?? kept.circuit,
			board: state.editorBoard ?? kept.board,
		});
	};
	const preloadEditorViews = async () => {
		const circuitId = currentCircuitId();
		const snapshot = state.active;
		if (!circuitId || !snapshot) {
			setEditorViews(null);
			return;
		}
		const index = projectIndex(snapshot);
		const drawing =
			circuitId === primaryPcbId
				? undefined
				: index.drawingsByCircuit.get(circuitId)?.file;
		const board = index.boardsByCircuit.get(circuitId)?.file;
		const views = {
			circuitId,
			schematic:
				circuitId === primaryPcbId
					? snapshot.manifest.drawing !== undefined
						? ("main" as const)
						: null
					: drawing
						? openDrawingDocument(drawing)
						: null,
			circuit: circuitDocuments.get(circuitId) ?? null,
			board: board ? openBoardDocument(board) : null,
		};
		setEditorViews(views);
		if (views.circuit) return;
		const generation = state.generation;
		const modules = await circuitModules();
		if (
			generation !== state.generation ||
			!state.mounted ||
			state.editorViews?.circuitId !== circuitId
		)
			return;
		const superseded = () =>
			generation !== state.generation ||
			!state.mounted ||
			state.editorViews?.circuitId !== circuitId;
		const read = () =>
			state.active
				? projectIndex(state.active).circuitsById.get(circuitId)?.file
				: undefined;
		let file = read();
		if (!file) return;
		let view: CircuitFile | undefined = file;
		if (needsLayout(file)) {
			const { circuit } = file;
			view = await laidOut(circuit, modules, false);
			file = read();
			if (!view || superseded() || file?.circuit !== circuit) return;
			if (file.graph.positions.length) view = file;
		}
		setEditorViews({
			...state.editorViews,
			circuit: openCircuitDocument(file, view, modules),
		});
	};

	let stopMain = () => {};
	const subscribeMain = () => {
		stopMain();
		let lastShapes = state.store.getSnapshot().shapes;
		stopMain = state.store.subscribe(() => {
			const shapes = state.store.getSnapshot().shapes;
			if (shapes === lastShapes) return;
			lastShapes = shapes;
			if (!state.active || state.synchronizing) return;
			state.needsSave = true;
			setDirty(true);
			void autosave(true).catch(() => undefined);
		});
	};

	const resetSplitAndSelection = () => {
		state.selectionHandoff = null;
		state.syncedSelection = null;
		publishSelection();
		setSplitViews([]);
	};
	return {
		openCircuit: (path: string) => {
			resetSplitAndSelection();
			return openCircuit(path);
		},
		openBoard: (path: string) => {
			resetSplitAndSelection();
			return openBoard(path);
		},
		switchEditorView,
		setSplitEditorViews,
		focusSplitView,
		preloadEditorViews,
		rememberViewSelection,
		takeSelectionHandoff,
		subscribeViewSelection,
		getViewSelection,
		circuitForViewSelection,
		circuitIdForView,
		selectEditorFile: (path?: string) => {
			resetSplitAndSelection();
			return selectEditorFile(path);
		},
		subscribeMain,
		stopMain: () => stopMain(),
	};
}
