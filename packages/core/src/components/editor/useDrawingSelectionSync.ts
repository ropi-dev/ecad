import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { useMemo } from "react";
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

export function useDrawingSelectionSync({
	enabled,
	view,
	store,
	session,
	selection,
	childKey,
}: {
	enabled: boolean;
	view: "schematic" | "pcb";
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
		view,
		store,
		selection: current,
		equal: sameSchematicSelection,
		receive: (source, circuit) =>
			(view === "pcb" ? boardFrom : schematicFrom)(
				store.getSnapshot().shapes,
				source,
				circuit,
			),
		apply(next) {
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
