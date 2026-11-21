import type { CircuitStore } from "@ecad/drawing-core/circuit/store.ts";
import type { Accessor, Setter } from "solid-js";
import {
	circuitSelectionFromBoard,
	circuitSelectionFromSchematic,
	pruneCircuitSelection,
	sameCircuitSelection,
} from "#/circuit/selection-sync.ts";
import type { CircuitSelection } from "#/components/circuit/circuitEditorState.ts";
import { useViewSelectionSync } from "#/projects/useViewSelectionSync.ts";

export function useCircuitSelectionSync(
	options: Accessor<{
		enabled: boolean;
		visible: boolean;
		active: boolean;
		circuitId: string | undefined;
		store: CircuitStore;
		storeVersion?: unknown;
		setSelection: Setter<CircuitSelection>;
		setCheckedPins: Setter<string[]>;
	}>,
	selection: Accessor<{ item: CircuitSelection; checkedPins: string[] }>,
) {
	useViewSelectionSync(() => {
		const {
			enabled,
			visible,
			active,
			circuitId,
			store,
			storeVersion,
			setSelection,
			setCheckedPins,
		} = options();
		return {
			enabled,
			visible,
			active,
			circuitId,
			view: "circuit",
			store,
			storeVersion,
			equal: sameCircuitSelection,
			receive: (source) =>
				source.view === "pcb"
					? circuitSelectionFromBoard(
							source.store.getSnapshot().shapes,
							store.getSnapshot().circuit,
							source.selection,
						)
					: source.view === "schematic"
						? {
								item: circuitSelectionFromSchematic(
									source.store.getSnapshot().shapes,
									store.getSnapshot(),
									source.selection,
								),
								checkedPins: [],
							}
						: { item: null, checkedPins: [] },
			apply(next) {
				const valid = pruneCircuitSelection(store.getSnapshot(), next);
				setSelection(valid.item);
				setCheckedPins([...valid.checkedPins]);
				return valid;
			},
		};
	}, selection);
}
