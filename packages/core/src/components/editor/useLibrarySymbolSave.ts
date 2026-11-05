import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import {
	symbolFileShapes,
	symbolFileWithShapes,
} from "#/drawing/symbol-file.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { isProjectError } from "#/projects/errors.ts";
import { useProjectActions } from "#/projects/ProjectProvider.tsx";
import type { SymbolEditTarget } from "#/symbol-library/storage.tsx";

/**
 * Opens a library symbol definition in its own drawing store and saves every
 * change back to the library, one save at a time. Unsaved edits are reported
 * to the project and guarded against page unload.
 */
export function useLibrarySymbolSave(target: SymbolEditTarget) {
	const [store] = useState(() =>
		measurePerformance(
			"editor.open-library-symbol",
			() => createDrawingStore(symbolFileShapes(target.file)),
			{ shapes: target.file.shapes.length },
		),
	);
	const drawing = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const saved = useRef(drawing.shapes);
	const [savedShapes, setSavedShapes] = useState(drawing.shapes);
	const pending = useRef<Promise<void> | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const dirty = drawing.shapes !== savedShapes;
	const reportUnsavedEdits = useProjectActions()?.reportUnsavedEdits;
	const editorKey = useId();
	useEffect(() => {
		reportUnsavedEdits?.(editorKey, dirty);
	}, [reportUnsavedEdits, editorKey, dirty]);
	useEffect(
		() => () => reportUnsavedEdits?.(editorKey, false),
		[reportUnsavedEdits, editorKey],
	);
	const save = useCallback(
		async function persist(): Promise<void> {
			while (pending.current) await pending.current;
			const shapes = store.getSnapshot().shapes;
			if (shapes === saved.current) return;
			setSaving(true);
			const work = Promise.resolve().then(async () => {
				try {
					await target.save(
						parseSymbolFile(
							JSON.stringify(symbolFileWithShapes(target.file, shapes)),
						),
					);
					saved.current = shapes;
					setSavedShapes(shapes);
					setError("");
				} catch (cause) {
					if (!isProjectError(cause, "ProjectConflict"))
						setError(
							errorMessage(cause, "Unable to save the symbol definition."),
						);
					throw cause;
				} finally {
					pending.current = null;
					setSaving(false);
				}
			});
			pending.current = work;
			await work;
			if (store.getSnapshot().shapes !== saved.current) await persist();
		},
		[store, target],
	);
	useEffect(() => {
		if (drawing.shapes === saved.current) return;
		void save().catch(() => undefined);
	}, [drawing.shapes, save]);
	useEffect(() => {
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);
	return { store, save, saving, error };
}
