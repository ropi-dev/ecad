import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { type Accessor, createMemo } from "solid-js";
import {
	boardSelectionFromComponents,
	componentsOfBoardSelection,
	componentsOfCircuitSelection,
	componentsOfSchematicSelection,
	type SchematicSelection,
	sameSchematicSelection,
	schematicSelectionFromCircuit,
	schematicSelectionFromComponents,
	type ViewSelection,
} from "#/circuit/selection-sync.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import { useViewSelectionSync } from "#/projects/useViewSelectionSync.ts";

const byId = (a: number, b: number) => a - b;
const nothing: SchematicSelection = { shapeIds: [], childKey: null };

function schematicFrom(
	shapes: readonly EditorShape[],
	source: ViewSelection,
	circuit: Circuit | undefined,
): SchematicSelection {
	if (source.view === "circuit")
		return schematicSelectionFromCircuit(
			shapes,
			source.store.getSnapshot().circuit,
			source.selection,
		);
	if (source.view === "pcb" && circuit)
		return schematicSelectionFromComponents(
			shapes,
			circuit,
			componentsOfBoardSelection(
				source.store.getSnapshot().shapes,
				source.selection,
			),
		);
	return nothing;
}

function boardFrom(
	shapes: readonly EditorShape[],
	source: ViewSelection,
	circuit: Circuit | undefined,
): SchematicSelection {
	const components =
		source.view === "circuit"
			? componentsOfCircuitSelection(
					source.store.getSnapshot().circuit,
					source.selection,
				)
			: source.view === "schematic" && circuit
				? componentsOfSchematicSelection(circuit, source.selection)
				: [];
	return boardSelectionFromComponents(shapes, components);
}

export function useDrawingSelectionSync(
	options: Accessor<{
		enabled: boolean;
		view: "schematic" | "pcb";
		store: ReturnType<typeof createDrawingStore>;
		session: EditorSession;
	}>,
	selection: Accessor<{
		shapeIds: ReadonlySet<number>;
		childKey: string | null;
	}>,
) {
	const current = createMemo(() => {
		const { shapeIds, childKey } = selection();
		return { shapeIds: [...shapeIds].sort(byId), childKey };
	});
	useViewSelectionSync(() => {
		const { enabled, view: shown, store: drawing, session: editor } = options();
		return {
			enabled,
			view: shown,
			store: drawing,
			equal: sameSchematicSelection,
			receive: (source: ViewSelection, circuit: Circuit | undefined) =>
				(shown === "pcb" ? boardFrom : schematicFrom)(
					drawing.getSnapshot().shapes,
					source,
					circuit,
				),
			apply(next: SchematicSelection) {
				editor.reveal(new Set(next.shapeIds));
				const selected = editor.getState().selection;
				editor.selectChild(
					next.shapeIds.length === 1 &&
						selected.size === 1 &&
						selected.has(next.shapeIds[0])
						? next.childKey
						: null,
				);
				const state = editor.getState();
				return {
					shapeIds: [...state.selection].sort(byId),
					childKey: state.childKey,
				};
			},
		};
	}, current);
}
