import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { type Accessor, createMemo } from "solid-js";
import {
	boardSelectionFromComponents,
	boardSelectionFromNet,
	circuitSelectionFromSchematic,
	componentsOfBoardSelection,
	componentsOfCircuitSelection,
	componentsOfSchematicSelection,
	netOfBoardSelection,
	type SchematicSelection,
	sameSchematicSelection,
	schematicSelectionFromCircuit,
	schematicSelectionFromComponents,
	type ViewSelection,
} from "#/circuit/selection-sync.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import { fromExternalStore } from "#/lib/external-store.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
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
	if (source.view === "pcb" && circuit) {
		const boardShapes = source.store.getSnapshot().shapes;
		const components = componentsOfBoardSelection(
			boardShapes,
			source.selection,
		);
		if (components.length)
			return schematicSelectionFromComponents(shapes, circuit, components);
		const netId = netOfBoardSelection(boardShapes, circuit, source.selection);
		if (netId)
			return schematicSelectionFromCircuit(shapes, circuit, {
				item: { kind: "net", id: netId },
				checkedPins: [],
			});
	}
	return nothing;
}

function boardFrom(
	shapes: readonly EditorShape[],
	source: ViewSelection,
	circuit: Circuit | undefined,
): SchematicSelection {
	if (source.view === "circuit") {
		if (source.selection.item?.kind === "net")
			return boardSelectionFromNet(shapes, source.selection.item.id);
		return boardSelectionFromComponents(
			shapes,
			componentsOfCircuitSelection(
				source.store.getSnapshot().circuit,
				source.selection,
			),
		);
	}
	if (source.view === "schematic" && circuit) {
		const components = componentsOfSchematicSelection(
			circuit,
			source.selection,
		);
		if (components.length)
			return boardSelectionFromComponents(shapes, components);
		const subject = circuitSelectionFromSchematic(
			source.store.getSnapshot().shapes,
			{
				circuit,
				graph: {
					format: "ecad-circuit-graph",
					version: 1,
					circuitId: circuit.id,
					positions: [],
				},
			},
			source.selection,
		);
		if (subject?.kind === "net")
			return boardSelectionFromNet(shapes, subject.id);
	}
	return nothing;
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
	const current = createMemo(
		() => {
			const { shapeIds, childKey } = selection();
			return { shapeIds: [...shapeIds].sort(byId), childKey };
		},
		{ equals: sameSchematicSelection },
	);
	const shapesSource = createMemo(() => {
		const currentStore = options().store;
		return fromExternalStore(
			currentStore.subscribe,
			() => currentStore.getSnapshot().shapes,
		);
	});
	const projectCircuits = useProjectSelection(
		({ project }) => project?.circuits,
	);
	const revision = createMemo(
		() => ({
			shapes: shapesSource()(),
			circuits: projectCircuits(),
		}),
		{
			equals: (a, b) => a.shapes === b.shapes && a.circuits === b.circuits,
		},
	);
	useViewSelectionSync(
		() => {
			const {
				enabled,
				view: shown,
				store: drawing,
				session: editor,
			} = options();
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
		},
		current,
		revision,
	);
}
