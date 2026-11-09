import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import { useMemo } from "react";
import {
	sameSchematicSelection,
	schematicSelectionFromCircuit,
} from "#/circuit/selection-sync.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import { useViewSelectionSync } from "#/projects/useViewSelectionSync.ts";

const byId = (a: number, b: number) => a - b;

export function useSchematicSelectionSync({
	enabled,
	store,
	session,
	selection,
	childKey,
}: {
	enabled: boolean;
	store: ReturnType<typeof createDrawingStore>;
	session: EditorSession;
	selection: ReadonlySet<number>;
	childKey: string | null;
}) {
	const current = useMemo(
		() => ({ shapeIds: [...selection].sort(byId), childKey }),
		[selection, childKey],
	);
	useViewSelectionSync({
		enabled,
		view: "schematic",
		store,
		selection: current,
		equal: sameSchematicSelection,
		receive: (source) =>
			schematicSelectionFromCircuit(
				store.getSnapshot().shapes,
				source.store.getSnapshot().circuit,
				source.selection,
			),
		apply(next) {
			// A selection made in the circuit view can be on any page.
			session.reveal(new Set(next.shapeIds));
			const selected = session.getState().selection;
			session.selectChild(
				next.shapeIds.length === 1 &&
					selected.size === 1 &&
					selected.has(next.shapeIds[0])
					? next.childKey
					: null,
			);
			const state = session.getState();
			return {
				shapeIds: [...state.selection].sort(byId),
				childKey: state.childKey,
			};
		},
	});
}
