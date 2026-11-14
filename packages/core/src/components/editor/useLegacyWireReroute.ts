import { replaceAndPlaceShapesEffect } from "@ecad/drawing-core/commands/drawing-commands.ts";
import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { useEffect, useState } from "react";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import { rerouteLegacyWires } from "#/drawing/diagonal-wires.ts";

const reroutedStores = new WeakSet<object>();

/**
 * Redraws diagonal wires from older drawings once per store, as one undoable
 * edit, and returns the notice to show while that edit is the current history
 * entry.
 */
export function useLegacyWireReroute({
	store,
	session,
	sheetless,
	ready,
	resolved,
}: {
	store: ReturnType<typeof createDrawingStore>;
	session: EditorSession;
	sheetless: boolean;
	ready: boolean;
	resolved: { shapes: EditorShape[]; errors: string[] };
}) {
	const [rerouteNotice, setRerouteNotice] = useState<{
		text: string;
		historyId: number;
	} | null>(null);
	useEffect(() => {
		if (
			sheetless ||
			!ready ||
			resolved.errors.length ||
			reroutedStores.has(store)
		)
			return;
		reroutedStores.add(store);
		const reroute = rerouteLegacyWires(resolved.shapes);
		if (
			reroute &&
			session.execute(
				replaceAndPlaceShapesEffect(
					reroute.replacements,
					reroute.additions,
					"Redraw diagonal wires",
				),
			)
		)
			setRerouteNotice({
				text: reroute.notice,
				historyId: store.getSnapshot().history.currentId,
			});
	});
	return rerouteNotice;
}
