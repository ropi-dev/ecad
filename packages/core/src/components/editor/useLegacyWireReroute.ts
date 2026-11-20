import { replaceAndPlaceShapesEffect } from "@ecad/drawing-core/commands/drawing-commands.ts";
import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
} from "solid-js";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import { rerouteLegacyWires } from "#/drawing/diagonal-wires.ts";

const reroutedStores = new WeakSet<object>();

/**
 * Redraws diagonal wires from older drawings once per store, as one undoable
 * edit, and returns the notice to show while that edit is the current history
 * entry.
 */
export function useLegacyWireReroute(
	options: Accessor<{
		store: ReturnType<typeof createDrawingStore>;
		session: EditorSession;
		sheetless: boolean;
		ready: boolean;
		resolved: { shapes: EditorShape[]; errors: string[] };
	}>,
) {
	const [rerouteNotice, setRerouteNotice] = createSignal<{
		text: string;
		historyId: number;
	} | null>(null);
	const pending = createMemo(() => {
		const { store, session, sheetless, ready, resolved } = options();
		if (
			sheetless ||
			!ready ||
			resolved.errors.length ||
			reroutedStores.has(store)
		)
			return null;
		return { store, session, shapes: resolved.shapes };
	});
	createEffect(pending, (next) => {
		if (!next || reroutedStores.has(next.store)) return;
		reroutedStores.add(next.store);
		const reroute = rerouteLegacyWires(next.shapes);
		if (
			reroute &&
			next.session.execute(
				replaceAndPlaceShapesEffect(
					reroute.replacements,
					reroute.additions,
					"Redraw diagonal wires",
				),
			)
		)
			setRerouteNotice({
				text: reroute.notice,
				historyId: next.store.getSnapshot().history.currentId,
			});
	});
	return rerouteNotice;
}
