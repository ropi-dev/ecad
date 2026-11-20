import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
} from "solid-js";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import {
	symbolFileShapes,
	symbolFileWithShapes,
} from "#/drawing/symbol-file.ts";
import { useExternalStore } from "#/lib/external-store.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { isProjectError } from "#/projects/errors.ts";
import { useProjectActions } from "#/projects/ProjectProvider.tsx";
import type { SymbolEditTarget } from "#/symbol-library/storage.ts";

type Attributes = SymbolEditTarget["file"]["attributes"];

interface SavedContent {
	readonly shapes: readonly EditorShape[];
	readonly attributes: Attributes;
}

interface OpenedSymbol {
	readonly target: SymbolEditTarget;
	readonly store: ReturnType<typeof createDrawingStore>;
	saved: SavedContent;
	attributes: Attributes;
	pending: Promise<void> | null;
}

/**
 * Opens a library symbol definition in its own drawing store and saves every
 * change back to the library, one save at a time. Unsaved edits are reported
 * to the project and guarded against page unload.
 */
export function useLibrarySymbolSave(target: Accessor<SymbolEditTarget>) {
	const opened = createMemo((): OpenedSymbol => {
		const current = target();
		const store = measurePerformance(
			"editor.open-library-symbol",
			() => createDrawingStore(symbolFileShapes(current.file)),
			{ shapes: current.file.shapes.length },
		);
		return {
			target: current,
			store,
			saved: {
				shapes: store.getSnapshot().shapes,
				attributes: current.file.attributes,
			},
			attributes: current.file.attributes,
			pending: null,
		};
	});
	const drawing = createMemo(() => useExternalStore(opened().store));
	const shapes = createMemo(() => drawing()().shapes);
	const [attributes, setAttributes] = createSignal<Attributes>(
		() => opened().attributes,
	);
	const [savedContent, setSavedContent] = createSignal<SavedContent>(
		() => opened().saved,
	);
	const [saving, setSaving] = createSignal(false);
	const [error, setError] = createSignal("");
	const dirty = createMemo(
		() =>
			shapes() !== savedContent().shapes ||
			attributes() !== savedContent().attributes,
	);
	const actions = useProjectActions();
	const editorKey = createUniqueId();
	const reportUnsavedEdits = createMemo(() => actions()?.reportUnsavedEdits);
	createEffect(
		() => [reportUnsavedEdits(), dirty()] as const,
		([report, unsavedEdits]) => {
			report?.(editorKey, unsavedEdits);
		},
	);
	createEffect(reportUnsavedEdits, (report) => () => {
		report?.(editorKey, false);
	});

	const unsaved = (session: OpenedSymbol) =>
		session.store.getSnapshot().shapes !== session.saved.shapes ||
		session.attributes !== session.saved.attributes;

	async function persist(session: OpenedSymbol): Promise<void> {
		while (session.pending) await session.pending;
		if (!unsaved(session)) return;
		const next = {
			shapes: session.store.getSnapshot().shapes,
			attributes: session.attributes,
		};
		setSaving(true);
		const work = Promise.resolve().then(async () => {
			try {
				const { attributes: _attributes, ...file } = symbolFileWithShapes(
					session.target.file,
					next.shapes,
				);
				await session.target.save(
					parseSymbolFile(
						JSON.stringify(
							next.attributes && Object.keys(next.attributes).length
								? { ...file, attributes: next.attributes }
								: file,
						),
					),
				);
				session.saved = next;
				if (session === opened()) setSavedContent(next);
				setError("");
			} catch (cause) {
				if (!isProjectError(cause, "ProjectConflict"))
					setError(
						errorMessage(cause, "Unable to save the symbol definition."),
					);
				throw cause;
			} finally {
				session.pending = null;
				setSaving(false);
			}
		});
		session.pending = work;
		await work;
		if (unsaved(session)) await persist(session);
	}

	const save = () => persist(opened());
	const changeAttributes = (next: Record<string, string>) => {
		opened().attributes = next;
		setAttributes(next);
	};
	createEffect(
		() => [opened(), shapes(), attributes()] as const,
		([session, currentShapes, currentAttributes]) => {
			if (
				currentShapes === session.saved.shapes &&
				currentAttributes === session.saved.attributes
			)
				return;
			void persist(session).catch(() => undefined);
		},
	);
	createEffect(dirty, (unsavedEdits) => {
		if (!unsavedEdits) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	});
	return {
		get store() {
			return opened().store;
		},
		save,
		get saving() {
			return saving();
		},
		get error() {
			return error();
		},
		get attributes() {
			return attributes();
		},
		changeAttributes,
	};
}
