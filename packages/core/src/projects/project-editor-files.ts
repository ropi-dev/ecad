import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import { symbolFileShapes } from "#/drawing/symbol-file.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { primaryPcbId } from "#/projects/pcb.ts";
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
) {
	const {
		documents,
		setDirty,
		setEditorCircuit,
		setEditorDrawing,
		setEditorSymbol,
		showError,
	} = state;
	const openCircuit = async (path: string) => {
		const selectionRequest = ++state.editorSelection;
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
		const snapshot = state.active;
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
			openedGeneration !== state.generation ||
			selectionRequest !== state.editorSelection ||
			!state.mounted
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
					if (state.synchronizing) return;
					state.needsSave = true;
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
			if (state.synchronizing) return;
			state.needsSave = true;
			setDirty(true);
			void autosave(true).catch(() => undefined);
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
		openCircuit,
		switchEditorView,
		selectEditorFile,
		subscribeMain,
		stopMain: () => stopMain(),
	};
}
