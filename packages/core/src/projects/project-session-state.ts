import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type { ViewSelection } from "#/circuit/selection-sync.ts";
import type { SymbolLibrary } from "#/components/editor/symbolFormat.ts";
import { createSerialQueue } from "#/lib/serial-queue.ts";
import { instrumentProjectStorage } from "#/performance/project-storage.ts";
import { createDocumentRegistry } from "#/projects/document-registry.ts";
import { isProjectError, type ProjectConflict } from "#/projects/errors.ts";
import type {
	AssetKind,
	ProjectAsset,
	ProjectSnapshot,
} from "#/projects/format.ts";
import { createLinkedPcbAssembler } from "#/projects/linked-pcb.ts";
import type {
	CircuitDocument,
	DrawingDocument,
	ProjectContextValue,
	SymbolDocument,
} from "#/projects/ProjectSession.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import type { ConfiguredSymbolLibrary } from "#/symbol-library/config.ts";

/**
 * The mutable state a project session shares between its modules. Values the
 * UI reads change through the setters, which notify subscribers once per
 * microtask; the other fields are internal bookkeeping.
 */
export type ProjectSessionState = ReturnType<typeof createProjectSessionState>;

export function createProjectSessionState(rawStorage: ProjectStorage) {
	const listeners = new Set<() => void>();
	const store = createDrawingStore();
	const documents = createDocumentRegistry<{
		circuit: CircuitDocument;
		symbol: SymbolDocument;
		drawing: DrawingDocument;
	}>();
	const state = {
		listeners,
		cached: undefined as ProjectContextValue | undefined,
		notificationPending: false,
		storage: instrumentProjectStorage(rawStorage),
		selectedAsset: null as ProjectAsset | null,
		project: null as ProjectSnapshot | null,
		/** The latest snapshot, including saves made while unmounted. */
		active: null as ProjectSnapshot | null,
		store,
		documents,
		circuitDocuments: documents.collection("circuit"),
		symbolDocuments: documents.collection("symbol"),
		drawingDocuments: documents.collection("drawing"),
		editorCircuit: null as CircuitDocument | null,
		/** The request that is opening a circuit, while one is. */
		openingCircuit: null as number | null,
		editorSymbol: null as SymbolDocument | null,
		editorDrawing: null as DrawingDocument | null,
		symbols: [] as SymbolLibrary,
		libraries: [] as readonly ConfiguredSymbolLibrary[],
		epoch: 0,
		generation: 0,
		editorSelection: 0,
		viewSelection: null as ViewSelection | null,
		selectionOrigins: new WeakSet<object>(),
		selectionHandoff: null as {
			view: ViewSelection["view"];
			circuitId: string;
			generation: number;
			source: ViewSelection;
		} | null,
		busy: true,
		dirty: false,
		needsSave: false,
		savedMainShapes: store.getSnapshot().shapes as EditorShape[],
		synchronizing: false,
		libraryRevision: 0,
		autosavePending: undefined as Promise<void> | undefined,
		error: "",
		libraryErrors: [] as readonly string[],
		unsavedEditors: new Set() as ReadonlySet<string>,
		conflict: null as ProjectConflict | null,
		hasConflict: false,
		pendingAssets: [] as { file: File; kind: AssetKind }[],
		/** Notified when project symbols or libraries change on disk. */
		symbolListeners: new Set<() => void>(),
		mounted: true,
		enqueue: createSerialQueue(),
		linkedAssembler: createLinkedPcbAssembler(),
	};

	function publish() {
		state.cached = undefined;
		if (state.notificationPending) return;
		state.notificationPending = true;
		queueMicrotask(() => {
			state.notificationPending = false;
			for (const listener of listeners) listener();
		});
	}

	const setSelectedAsset = (next: ProjectAsset | null) => {
		if (Object.is(next, state.selectedAsset)) return;
		state.selectedAsset = next;
		publish();
	};
	const setProject = (next: ProjectSnapshot | null) => {
		if (Object.is(next, state.project)) return;
		state.project = next;
		publish();
	};
	const setStore = (next: ReturnType<typeof createDrawingStore>) => {
		if (Object.is(next, state.store)) return;
		state.store = next;
		publish();
	};
	const setEditorCircuit = (next: CircuitDocument | null) => {
		if (Object.is(next, state.editorCircuit)) return;
		state.editorCircuit = next;
		publish();
	};
	const setOpeningCircuit = (next: number | null) => {
		if (next === state.openingCircuit) return;
		state.openingCircuit = next;
		publish();
	};
	const setEditorSymbol = (next: SymbolDocument | null) => {
		if (Object.is(next, state.editorSymbol)) return;
		state.editorSymbol = next;
		publish();
	};
	const setEditorDrawing = (next: DrawingDocument | null) => {
		if (Object.is(next, state.editorDrawing)) return;
		state.editorDrawing = next;
		publish();
	};
	const setEpoch = (next: number) => {
		if (Object.is(next, state.epoch)) return;
		state.epoch = next;
		publish();
	};
	const setBusy = (next: boolean) => {
		if (Object.is(next, state.busy)) return;
		state.busy = next;
		publish();
	};
	const setDirty = (next: boolean) => {
		if (Object.is(next, state.dirty)) return;
		state.dirty = next;
		publish();
	};
	const setError = (next: string) => {
		if (Object.is(next, state.error)) return;
		state.error = next;
		publish();
	};
	const setLibraryErrors = (
		next:
			| readonly string[]
			| ((current: readonly string[]) => readonly string[]),
	) => {
		const value =
			typeof next === "function"
				? (
						next as (
							current: typeof state.libraryErrors,
						) => typeof state.libraryErrors
					)(state.libraryErrors)
				: next;
		if (Object.is(value, state.libraryErrors)) return;
		state.libraryErrors = value;
		publish();
	};
	const setUnsavedEditors = (
		next:
			| ReadonlySet<string>
			| ((current: ReadonlySet<string>) => ReadonlySet<string>),
	) => {
		const value =
			typeof next === "function"
				? (
						next as (
							current: typeof state.unsavedEditors,
						) => typeof state.unsavedEditors
					)(state.unsavedEditors)
				: next;
		if (Object.is(value, state.unsavedEditors)) return;
		state.unsavedEditors = value;
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
	const setHasConflict = (next: boolean) => {
		if (Object.is(next, state.hasConflict)) return;
		state.hasConflict = next;
		publish();
	};
	const noteConflict = (cause: unknown) => {
		if (!isProjectError(cause, "ProjectConflict")) return;
		state.conflict = cause;
		if (state.mounted) setHasConflict(true);
	};
	const showError = (cause: unknown, fallback: string) => {
		if (isProjectError(cause, "ProjectConflict")) noteConflict(cause);
		else setError(errorMessage(cause, fallback));
	};
	const update = (snapshot: ProjectSnapshot) => {
		state.active = snapshot;
		if (state.mounted) setProject(snapshot);
	};

	return Object.assign(state, {
		publish,
		setSelectedAsset,
		setProject,
		setStore,
		setEditorCircuit,
		setOpeningCircuit,
		setEditorSymbol,
		setEditorDrawing,
		setEpoch,
		setBusy,
		setDirty,
		setError,
		setLibraryErrors,
		reportUnsavedEdits,
		setHasConflict,
		noteConflict,
		showError,
		update,
	});
}
