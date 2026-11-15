import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import { createBoardFile } from "#/board/format.ts";
import { createBoardRulesStore } from "#/board/rules-store.ts";
import type { ViewSelection } from "#/circuit/selection-sync.ts";
import { symbolFileShapes } from "#/drawing/symbol-file.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import type { EditorView } from "#/projects/ProjectSession.ts";
import { pcbDocumentName, primaryPcbId } from "#/projects/pcb.ts";
import { projectIndex } from "#/projects/project-index.ts";
import type { ProjectSessionState } from "#/projects/project-session-state.ts";

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
		setDirty,
		setEditorCircuit,
		setOpeningCircuit,
		setEditorDrawing,
		setEditorSymbol,
		setEditorFootprint,
		setEditorBoard,
		showError,
	} = state;
	const clearEditors = (
		keep?: "symbol" | "footprint" | "board" | "drawing" | "circuit",
	) => {
		if (keep !== "symbol") setEditorSymbol(null);
		if (keep !== "footprint") setEditorFootprint(null);
		if (keep !== "board") setEditorBoard(null);
		if (keep !== "drawing") setEditorDrawing(null);
		if (keep !== "circuit") setEditorCircuit(null);
	};
	const openCircuit = async (path: string) => {
		const selectionRequest = ++state.editorSelection;
		// The editor waits for this circuit instead of showing the schematic.
		setOpeningCircuit(selectionRequest);
		try {
			return await loadCircuit(path, selectionRequest);
		} finally {
			if (state.openingCircuit === selectionRequest) setOpeningCircuit(null);
		}
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
		const [{ createCircuitStore }, { createCircuitView }] = await Promise.all([
			import("@ecad/drawing-core/circuit/store.ts"),
			import("@ecad/drawing-core/circuit/untangle.ts"),
		]);
		if (
			openedGeneration !== state.generation ||
			selectionRequest !== state.editorSelection ||
			!state.mounted
		)
			return false;
		// Read the file after the import, which a reload from disk may span.
		const snapshot = state.active;
		const file =
			snapshot && circuitId
				? projectIndex(snapshot).circuitsById.get(circuitId)?.file
				: undefined;
		if (!file) throw new Error("Circuit file no longer exists.");
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
					if (state.synchronizing) return;
					state.needsSave = true;
					setDirty(true);
					void autosave(true).catch(() => undefined);
				}),
			};
		});
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
			const handoff =
				view !== "pcb" &&
				remembered &&
				remembered.store ===
					(state.editorCircuit?.store ??
						state.editorDrawing?.store ??
						state.store)
					? {
							view,
							circuitId: selectedCircuitId,
							generation: state.generation,
							source: remembered.origin ?? remembered,
						}
					: null;
			state.selectionHandoff = handoff;
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
	const rememberViewSelection = (selection: ViewSelection) => {
		const { origin, ...current } = selection;
		state.viewSelection =
			!origin || state.selectionOrigins.has(origin) ? selection : current;
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
		return handoff.source;
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
		const document = documents.openDocument("board", board.circuitId, () => {
			const boardStore = measurePerformance(
				"editor.open-board",
				() => createDrawingStore(board.shapes),
				{ shapes: board.shapes.length },
			);
			const rules = createBoardRulesStore(board.rules);
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
					stopShapes();
					stopRules();
				},
			};
		});
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
			clearEditors();
			return true;
		}
		const drawing = projectIndex(snapshot).drawingsByPath.get(path);
		if (drawing) {
			const document = documents.openDocument("drawing", drawing.id, () => {
				const drawingStore = measurePerformance(
					"editor.open-drawing",
					() => createDrawingStore(drawing.shapes, drawing.pages),
					{ shapes: drawing.shapes.length },
				);
				return {
					file: drawing,
					store: drawingStore,
					savedShapes: drawingStore.getSnapshot().shapes,
					unsubscribe: subscribeDrawing(drawingStore),
				};
			});
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

	return {
		openCircuit: (path: string) => {
			state.selectionHandoff = null;
			return openCircuit(path);
		},
		openBoard: (path: string) => {
			state.selectionHandoff = null;
			return openBoard(path);
		},
		switchEditorView,
		rememberViewSelection,
		takeSelectionHandoff,
		selectEditorFile: (path?: string) => {
			state.selectionHandoff = null;
			return selectEditorFile(path);
		},
		subscribeMain,
		stopMain: () => stopMain(),
	};
}
