import type { CircuitStore } from "@ecad/drawing-core/circuit/store.ts";
import { type Accessor, createMemo, type Setter } from "solid-js";
import {
	circuitSelectionFromComponents,
	circuitSelectionFromSchematic,
	componentsOfBoardSelection,
	netOfBoardSelection,
	pruneCircuitSelection,
	sameCircuitSelection,
} from "#/circuit/selection-sync.ts";
import type { CircuitSelection } from "#/components/circuit/circuitEditorState.ts";
import { fromExternalStore } from "#/lib/external-store.ts";
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
	const stableSelection = createMemo(selection, {
		equals: sameCircuitSelection,
	});
	const circuitSource = createMemo(() => {
		const currentStore = options().store;
		return fromExternalStore(
			currentStore.subscribe,
			() => currentStore.getSnapshot().circuit,
		);
	});
	useViewSelectionSync(
		() => {
			const { enabled, store, setSelection, setCheckedPins } = options();
			return {
				enabled,
				view: "circuit",
				store,
				equal: sameCircuitSelection,
				receive: (source) => {
					if (source.view === "pcb") {
						const boardShapes = source.store.getSnapshot().shapes;
						const components = componentsOfBoardSelection(
							boardShapes,
							source.selection,
						);
						if (components.length)
							return circuitSelectionFromComponents(components);
						const netId = netOfBoardSelection(
							boardShapes,
							store.getSnapshot().circuit,
							source.selection,
						);
						return {
							item: netId ? { kind: "net", id: netId } : null,
							checkedPins: [],
						};
					}
					if (source.view === "schematic")
						return {
							item: circuitSelectionFromSchematic(
								source.store.getSnapshot().shapes,
								store.getSnapshot(),
								source.selection,
							),
							checkedPins: [],
						};
					return { item: null, checkedPins: [] };
				},
				apply(next) {
					const valid = pruneCircuitSelection(store.getSnapshot(), next);
					setSelection(valid.item);
					setCheckedPins([...valid.checkedPins]);
					return valid;
				},
			};
		},
		stableSelection,
		() => circuitSource()(),
	);
}
