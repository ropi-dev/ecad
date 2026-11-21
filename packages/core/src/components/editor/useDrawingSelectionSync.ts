import type { CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { type Accessor, createMemo } from "solid-js";
import {
	boardSelectionFromSource,
	type SchematicSelection,
	sameSchematicSelection,
	schematicSelectionFromBoard,
	schematicSelectionFromCircuit,
	type ViewSelection,
} from "#/circuit/selection-sync.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { useViewSelectionSync } from "#/projects/useViewSelectionSync.ts";

const byId = (a: number, b: number) => a - b;
const nothing: SchematicSelection = { shapeIds: [], childKey: null };

function schematicFrom(
	shapes: readonly EditorShape[],
	source: ViewSelection,
	circuitFile: CircuitFile | undefined,
): SchematicSelection {
	if (source.view === "circuit")
		return schematicSelectionFromCircuit(
			shapes,
			source.store.getSnapshot().circuit,
			source.selection,
		);
	if (source.view === "pcb" && circuitFile)
		return schematicSelectionFromBoard(
			shapes,
			source.store.getSnapshot().shapes,
			circuitFile.circuit,
			source.selection,
		);
	return nothing;
}

export function useDrawingSelectionSync(
	options: Accessor<{
		enabled: boolean;
		visible: boolean;
		active: boolean;
		circuitId: string | undefined;
		view: "schematic" | "pcb";
		store: ReturnType<typeof createDrawingStore>;
		session: EditorSession;
		storeVersion?: unknown;
	}>,
	selection: Accessor<{
		shapeIds: ReadonlySet<number>;
		childKey: string | null;
	}>,
): Accessor<string | undefined> {
	const current = createMemo(() => {
		const { shapeIds, childKey } = selection();
		return { shapeIds: [...shapeIds].sort(byId), childKey };
	});
	useViewSelectionSync(() => {
		const {
			enabled,
			visible,
			active,
			circuitId,
			view: shown,
			store: drawing,
			session: editor,
			storeVersion,
		} = options();
		return {
			enabled,
			visible,
			active,
			circuitId,
			view: shown,
			store: drawing,
			storeVersion,
			equal: sameSchematicSelection,
			receive: (
				source: ViewSelection,
				circuitFile: CircuitFile | undefined,
			) => {
				const shapes = drawing.getSnapshot().shapes;
				return shown === "pcb"
					? boardSelectionFromSource(shapes, source, circuitFile).selection
					: schematicFrom(shapes, source, circuitFile);
			},
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
	const project = useProjectSelection(
		({ selectionSync, circuitForSelection }) => ({
			selectionSync,
			circuitForSelection,
		}),
	);
	return createMemo(() => {
		const { enabled, visible, view, circuitId, store } = options();
		const sync = project()?.selectionSync;
		const circuitForSelection = project()?.circuitForSelection;
		if (
			!enabled ||
			!visible ||
			view !== "pcb" ||
			!circuitId ||
			!sync ||
			!circuitForSelection ||
			sync.circuitId !== circuitId ||
			sync.source.view === "pcb"
		)
			return undefined;
		const { selection: target, netId } = boardSelectionFromSource(
			store.getSnapshot().shapes,
			sync.source,
			circuitForSelection(circuitId),
		);
		return netId !== null && sameSchematicSelection(target, current())
			? netId
			: undefined;
	});
}
