import type { CircuitStore } from "@ecad/drawing-core/circuit/store.ts";
import type { Accessor, Setter } from "solid-js";
import {
	circuitSelectionFromComponents,
	circuitSelectionFromSchematic,
	componentsOfBoardSelection,
	pruneCircuitSelection,
	sameCircuitSelection,
} from "#/circuit/selection-sync.ts";
import type { CircuitSelection } from "#/components/circuit/circuitEditorState.ts";
import { useViewSelectionSync } from "#/projects/useViewSelectionSync.ts";

export function useCircuitSelectionSync(
	options: Accessor<{
		enabled: boolean;
		store: CircuitStore;
		setSelection: Setter<CircuitSelection>;
		setCheckedPins: Setter<string[]>;
	}>,
	selection: Accessor<{ item: CircuitSelection; checkedPins: string[] }>,
) {
	useViewSelectionSync(() => {
		const { enabled, store, setSelection, setCheckedPins } = options();
		return {
			enabled,
			view: "circuit",
			store,
			equal: sameCircuitSelection,
			receive: (source) =>
				source.view === "pcb"
					? circuitSelectionFromComponents(
							componentsOfBoardSelection(
								source.store.getSnapshot().shapes,
								source.selection,
							),
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
