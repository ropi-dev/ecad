import type { CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { SymbolLibrary } from "#/components/editor/symbolFormat.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";
import { replaceDrawingShapes } from "#/projects/drawing-refresh.ts";
import { isProjectError } from "#/projects/errors.ts";
import type { ProjectDrawing, ProjectSnapshot } from "#/projects/format.ts";
import { primaryPcbId } from "#/projects/pcb.ts";
import type { createProjectAssets } from "#/projects/project-assets.ts";
import type { ProjectSessionState } from "#/projects/project-session-state.ts";
import type { ConfiguredSymbolLibrary } from "#/symbol-library/config.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.tsx";

type ProjectAssets = ReturnType<typeof createProjectAssets>;

/**
 * Saving: `persist` writes every open document into the project and
 * synchronizes the stores with what was saved, `autosave` coalesces and
 * repeats saves while edits keep arriving, and `save` also writes the project
 * to disk when the storage supports it.
 */
export function createProjectAutosave(
	state: ProjectSessionState,
	symbolStorage: SymbolLibraryStorage,
	transferAssets: ProjectAssets["transferAssets"],
) {
	const {
		storage,
		enqueue,
		linkedAssembler,
		circuitDocuments,
		symbolDocuments,
		drawingDocuments,
		noteConflict,
		showError,
		update,
		setBusy,
		setDirty,
		setError,
		setLibraryErrors,
	} = state;
	const persist = async (
		nextSymbols?: SymbolLibrary,
		nextLibraries?: readonly ConfiguredSymbolLibrary[],
		nextDrawings?: ProjectDrawing[],
		nextCircuits?: CircuitFile[],
	) => {
		const previous = state.active;
		const savingLibraryRevision = state.libraryRevision;
		if (!previous) return;
		if (state.conflict) throw state.conflict;
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
		const { shapes: mainShapes, pages: mainPages } = state.store.getSnapshot();
		const circuitInputs = new Map(
			[...circuitDocuments.values()].map((entry) => [
				entry.file.circuit.id,
				entry.store.getSnapshot().circuit,
			]),
		);
		const drawings = nextDrawings ?? previous.drawings;
		const drawingEdits = new Map(
			[...drawingDocuments.values()].map((entry) => {
				const { shapes, pages } = entry.store.getSnapshot();
				return [entry.file.id, { shapes, pages }] as const;
			}),
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
			symbols: nextSymbols ?? state.symbols,
			libraries: nextLibraries ?? state.libraries,
			pending,
			mainShapes,
			mainPages,
			drawings,
			drawingEdits,
			savedCircuits,
		});

		const linked = await linkedAssembler.assemble(
			document,
			previous,
			symbolStorage,
			(errors) => {
				if (state.mounted)
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
		state.synchronizing = true;
		const savedMainShapes =
			state.store.getSnapshot().shapes === mainShapes
				? replaceDrawingShapes(
						state.store,
						document.shapes,
						externalDrawings.has(primaryPcbId),
						document.pages,
					)
				: document.shapes;
		const savedDrawingShapes = new Map<string, EditorShape[]>();
		for (const drawing of document.drawings ?? []) {
			const target = drawingDocuments.get(drawing.id);
			if (
				target &&
				target.store.getSnapshot().shapes ===
					drawingEdits.get(drawing.id)?.shapes
			)
				savedDrawingShapes.set(
					drawing.id,
					replaceDrawingShapes(
						target.store,
						drawing.shapes,
						externalDrawings.has(drawing.id),
						drawing.pages,
					),
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

		state.synchronizing = false;
		state.savedMainShapes = savedMainShapes;
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
			if (edit)
				edit.savedShapes = savedDrawingShapes.get(file.id) ?? file.shapes;
		}
		state.symbols = document.symbols;
		state.libraries = document.symbolLibraries;
		linkedAssembler.accept(
			next,
			new Map(
				[...circuitDocuments].map(([id, entry]) => [id, entry.savedFile]),
			),
		);
		update(next);
		if (state.mounted) {
			state.needsSave =
				state.libraryRevision !== savingLibraryRevision ||
				state.store.getSnapshot().shapes !== state.savedMainShapes ||
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
			setDirty(state.needsSave);
			setError("");
		}
	};
	const autosave = (onlyIfDirty = false): Promise<void> => {
		if (onlyIfDirty && (state.conflict || state.synchronizing))
			return Promise.resolve();
		if (state.autosavePending) return state.autosavePending;
		const pending = enqueue(async () => {
			if (onlyIfDirty && (!state.needsSave || state.conflict)) return;
			do {
				await persist();
				await transferAssets([]);
			} while (state.needsSave && !state.conflict && state.mounted);
		});
		state.autosavePending = pending
			.catch((cause) => {
				if (state.mounted && !isProjectError(cause, "ProjectConflict")) {
					state.needsSave = true;
					setDirty(true);
					showError(cause, "Unable to save the project.");
				}
				throw cause;
			})
			.finally(() => {
				state.autosavePending = undefined;
			});
		return state.autosavePending;
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
				const snapshot = state.active;
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
	return { persist, autosave, save };
}
