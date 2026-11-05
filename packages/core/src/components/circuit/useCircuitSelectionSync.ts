import type { CircuitStore } from "@ecad/drawing-core/circuit/store.ts";
import { type Dispatch, type SetStateAction, useMemo } from "react";
import {
	circuitSelectionFromSchematic,
	pruneCircuitSelection,
	sameCircuitSelection,
} from "#/circuit/selection-sync.ts";
import type { CircuitSelection } from "#/components/circuit/circuitEditorState.ts";
import { useViewSelectionSync } from "#/projects/useViewSelectionSync.ts";

export function useCircuitSelectionSync({
	store,
	selection,
	checkedPins,
	setSelection,
	setCheckedPins,
}: {
	store: CircuitStore;
	selection: CircuitSelection;
	checkedPins: string[];
	setSelection: Dispatch<SetStateAction<CircuitSelection>>;
	setCheckedPins: Dispatch<SetStateAction<string[]>>;
}) {
	const current = useMemo(
		() => ({ item: selection, checkedPins }),
		[selection, checkedPins],
	);
	useViewSelectionSync({
		view: "circuit",
		store,
		selection: current,
		equal: sameCircuitSelection,
		receive: (source) => ({
			item: circuitSelectionFromSchematic(
				source.store.getSnapshot().shapes,
				store.getSnapshot(),
				source.selection,
			),
			checkedPins: [],
		}),
		apply(next) {
			const valid = pruneCircuitSelection(store.getSnapshot(), next);
			setSelection(valid.item);
			setCheckedPins([...valid.checkedPins]);
			return valid;
		},
	});
}
