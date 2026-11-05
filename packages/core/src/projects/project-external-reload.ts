import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { toastManager } from "#/components/ui/toast.ts";
import { symbolFileShapes } from "#/drawing/symbol-file.ts";
import { replaceDrawingShapes } from "#/projects/drawing-refresh.ts";
import { isProjectError, ProjectConflict } from "#/projects/errors.ts";
import { PROJECT_FILE, type ProjectSnapshot } from "#/projects/format.ts";
import { projectIndex } from "#/projects/project-index.ts";
import type { ProjectSessionState } from "#/projects/project-session-state.ts";
import type { ProjectRefresh } from "#/projects/storage.ts";

const toastId = "project-external-reload";
type SaveAssembly = typeof import("#/projects/save-assembly.ts");

/**
 * Applies changes another program made to the open project's files. Only
 * the documents whose files changed are replaced, and each of them starts a
 * new undo history. Other documents keep their stores, history and view.
 * Unsaved local edits are never replaced: the change becomes a conflict
 * instead, which pauses saving until the user reloads.
 */
export function createProjectExternalReload(
	state: ProjectSessionState,
	autosave: () => Promise<void>,
) {
	const {
		storage,
		enqueue,
		drawingDocuments,
		symbolDocuments,
		circuitDocuments,
		linkedAssembler,
		noteConflict,
		update,
		setEditorCircuit,
		setEditorDrawing,
		setEditorSymbol,
		setSelectedAsset,
	} = state;
	const unsaved = () => state.needsSave || state.unsavedEditors.size > 0;
	let queued = false;

	function apply(
		{ snapshot, changed: paths }: ProjectRefresh,
		withCurrentGraph: SaveAssembly["withCurrentGraph"],
	) {
		const previous = state.active as ProjectSnapshot;
		const changed = new Set(paths);
		const before = projectIndex(previous);
		const after = projectIndex(snapshot);
		const moved = (path: string, previousPath: string | undefined) =>
			changed.has(path) || path !== previousPath;
		const names: string[] = [];
		const closed: string[] = [];
		state.synchronizing = true;
		try {
			// A manifest can also point a document at another existing file.
			if (
				changed.has(snapshot.manifest.drawing) ||
				snapshot.manifest.drawing !== previous.manifest.drawing
			) {
				replaceDrawingShapes(state.store, snapshot.shapes, true);
				state.savedMainShapes = state.store.getSnapshot().shapes;
				names.push(snapshot.manifest.name);
			}
			for (const [id, document] of drawingDocuments) {
				const next = after.drawingsById.get(id);
				if (!next?.path) {
					document.unsubscribe();
					drawingDocuments.delete(id);
					closed.push(document.file.name);
					if (state.editorDrawing === document) setEditorDrawing(null);
					continue;
				}
				if (!moved(next.path, before.drawingsById.get(id)?.path)) continue;
				replaceDrawingShapes(document.store, next.file.shapes, true);
				const replaced = {
					...document,
					file: next.file,
					savedShapes: document.store.getSnapshot().shapes,
				};
				drawingDocuments.set(id, replaced);
				if (state.editorDrawing === document) setEditorDrawing(replaced);
			}
			for (const [id, document] of symbolDocuments) {
				const next = after.symbolsById.get(id);
				if (!next?.path) {
					document.unsubscribe();
					symbolDocuments.delete(id);
					closed.push(document.file.name);
					if (state.editorSymbol === document) setEditorSymbol(null);
					continue;
				}
				if (!moved(next.path, before.symbolsById.get(id)?.path)) continue;
				replaceDrawingShapes(document.store, symbolFileShapes(next.file), true);
				const replaced = {
					...document,
					file: next.file,
					savedShapes: document.store.getSnapshot().shapes,
				};
				symbolDocuments.set(id, replaced);
				if (state.editorSymbol === document) setEditorSymbol(replaced);
			}
			for (const [id, document] of circuitDocuments) {
				const next = after.circuitsById.get(id);
				if (!next?.path) {
					document.unsubscribe();
					circuitDocuments.delete(id);
					closed.push(document.file.circuit.name);
					if (state.editorCircuit === document) setEditorCircuit(null);
					continue;
				}
				if (!moved(next.path, before.circuitsById.get(id)?.path)) continue;
				document.store.synchronize(
					withCurrentGraph(next.file, document.store.getSnapshot().graph),
					{ preserveHistory: false },
				);
				const replaced = {
					...document,
					file: next.file,
					savedFile: document.store.getSnapshot(),
				};
				circuitDocuments.set(id, replaced);
				if (state.editorCircuit === document) setEditorCircuit(replaced);
			}
		} finally {
			state.synchronizing = false;
		}
		for (const [id, entry] of after.drawingsById)
			if (entry.path && moved(entry.path, before.drawingsById.get(id)?.path))
				names.push(entry.file.name);
		for (const [id, entry] of after.symbolsById)
			if (entry.path && moved(entry.path, before.symbolsById.get(id)?.path))
				names.push(entry.file.name);
		if (
			state.selectedAsset &&
			!snapshot.manifest.assets.some(
				(asset) => asset.path === state.selectedAsset?.path,
			)
		)
			setSelectedAsset(null);
		state.symbols = snapshot.symbols;
		state.libraries = snapshot.symbolLibraries ?? [];
		linkedAssembler.invalidate();
		update(snapshot);
		if (
			changed.has(snapshot.manifest.drawing) ||
			changed.has(PROJECT_FILE) ||
			snapshot.manifest.symbols.some((path) => changed.has(path))
		)
			for (const listener of state.symbolListeners) listener();
		// A delayed open must not bring back a closed document.
		if (closed.length) state.editorSelection++;
		toastManager.add({
			id: toastId,
			type: closed.length ? "warning" : "info",
			title: "Reloaded changes from disk",
			description: [
				names.length
					? `Updated ${[...new Set(names)].join(", ")}.`
					: "Updated the project files.",
				closed.length
					? `Closed ${closed.join(", ")}, which no longer exist.`
					: "",
			]
				.filter(Boolean)
				.join(" "),
		});
	}

	return async (directory: string) => {
		const refresh = storage.refresh?.bind(storage);
		const active = state.active;
		if (
			!refresh ||
			queued ||
			!active ||
			active.inMemory ||
			active.directory !== directory ||
			state.conflict
		)
			return;
		// A save of the local edits finds the external change and reports a
		// conflict, so neither version is overwritten.
		if (unsaved() || state.autosavePending) {
			await autosave().catch(() => undefined);
			if (state.conflict || unsaved()) return;
		}
		queued = true;
		let started = false;
		try {
			await enqueue(async () => {
				started = true;
				queued = false;
				const generation = state.generation;
				if (
					state.conflict ||
					!state.mounted ||
					state.active?.directory !== directory
				)
					return;
				if (unsaved()) {
					void autosave().catch(() => undefined);
					return;
				}
				const { withCurrentGraph } = await import(
					"#/projects/save-assembly.ts"
				);
				const refreshed = await refresh(directory);
				if (!refreshed || generation !== state.generation || !state.mounted)
					return;
				// The files on disk are now the saved state, so an edit made while
				// they were read would overwrite them without a conflict.
				if (unsaved()) {
					noteConflict(
						new ProjectConflict({ path: refreshed.changed[0] ?? PROJECT_FILE }),
					);
					return;
				}
				try {
					apply(refreshed, withCurrentGraph);
				} catch (cause) {
					// The main process already accepted the disk files, so a save of
					// partly replaced documents could overwrite them. Saving pauses
					// until the user reloads.
					noteConflict(
						new ProjectConflict({ path: refreshed.changed[0] ?? PROJECT_FILE }),
					);
					throw cause;
				}
			});
		} catch (cause) {
			// Switching projects during the refresh closes the old one. A conflict
			// already explains a failure after the files were read.
			if (
				state.mounted &&
				!state.conflict &&
				!isProjectError(cause, "ProjectClosed")
			)
				toastManager.add({
					id: toastId,
					type: "warning",
					title: "Unable to reload changes from disk",
					description: `${errorMessage(cause, "The project files could not be read.")} Your open documents are unchanged.`,
				});
		} finally {
			// The task clears the flag when it starts, and a later call may have
			// set it again since.
			if (!started) queued = false;
		}
	};
}
