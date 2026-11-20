import type { buildCircuitGraph } from "@ecad/drawing-core/circuit/graph.ts";
import type { GraphLayout } from "@ecad/drawing-core/circuit/model.ts";
import type {
	CircuitCommand,
	CircuitStore,
} from "@ecad/drawing-core/circuit/store.ts";
import {
	type Accessor,
	createEffect,
	createMemo,
	createProjection,
	type Setter,
} from "solid-js";
import {
	type CircuitSelectionItem,
	pruneCircuitSelection,
	sameCircuitSelection,
} from "#/circuit/selection-sync.ts";
import type { SelectionMode } from "#/components/editor/selectionMode.ts";

export type CircuitSelection = CircuitSelectionItem | null;
export type CircuitPosition = GraphLayout["positions"][number];
export type CircuitGraph = ReturnType<typeof buildCircuitGraph>;
export type CircuitDrag = {
	position: CircuitPosition;
	start: { x: number; y: number };
	startClient: { x: number; y: number };
	active: boolean;
	x: number;
	y: number;
	pointerId: number;
};
export type ConnectionDrag = {
	pinId: string;
	pointerId: number;
	start: { x: number; y: number };
	point: { x: number; y: number };
	active: boolean;
	target: { kind: "pin" | "net"; id: string } | null;
};
export type GraphButtonEvent<E extends Event> = E & {
	currentTarget: HTMLButtonElement;
};

/** Editor commands the graph's nodes and connections call. */
export interface CircuitGraphActions {
	select(next: CircuitSelection): void;
	edit(item: NonNullable<CircuitSelection>): void;
	finishEditing(): void;
	openMenu(
		event: GraphButtonEvent<MouseEvent>,
		item: NonNullable<CircuitSelection>,
	): void;
	selectPin(id: string): void;
	selectNet(id: string): void;
	selectConnection(id: string, mode: SelectionMode): void;
	startDrag(
		event: GraphButtonEvent<PointerEvent>,
		position: CircuitPosition,
	): void;
	startConnectionDrag(
		event: GraphButtonEvent<PointerEvent>,
		pinId: string,
	): void;
	run(command: CircuitCommand): boolean;
	snap<T extends { x: number; y: number }>(position: T): T;
}

export function createIdFlags(
	ids: () => readonly (string | null | undefined)[],
): Readonly<Record<string, boolean>> {
	let previous: string[] = [];
	return createProjection<Record<string, boolean>>((draft) => {
		const next = ids().filter((id): id is string => !!id);
		for (const id of previous) if (!next.includes(id)) delete draft[id];
		for (const id of next) draft[id] = true;
		previous = next;
	}, {});
}

/**
 * Drops gestures, selections and edits whose component, pin, net or
 * connection no longer exists after the circuit changes, for example after
 * undo or a sync from the schematic. Pins on collapsed components count as
 * gone.
 */
export function usePruneToSnapshot(
	snapshot: Accessor<ReturnType<CircuitStore["getSnapshot"]>>,
	state: {
		selection: Accessor<CircuitSelection>;
		checkedPins: Accessor<string[]>;
		setDrag: Setter<CircuitDrag | null>;
		setConnectionDrag: Setter<ConnectionDrag | null>;
		setCheckedPins: Setter<string[]>;
		setSelection: Setter<CircuitSelection>;
		setEditing: Setter<CircuitSelection>;
		setPendingPin: Setter<string | null>;
	},
) {
	const pruning = createMemo(
		() => ({
			next: snapshot(),
			current: { item: state.selection(), checkedPins: state.checkedPins() },
		}),
		{ equals: (a, b) => a.next === b.next },
	);
	createEffect(pruning, ({ next, current }) => {
		// Saves and schematic syncs publish new snapshots without changing what the
		// user picked, so keep the selection while it still exists. The selected
		// connection and the checked pins are pruned together so they stay paired.
		const valid = pruneCircuitSelection(next, current);
		if (!sameCircuitSelection(valid, current)) {
			state.setSelection(valid.item);
			state.setCheckedPins([...valid.checkedPins]);
		}
		state.setDrag((drag) =>
			drag &&
			(drag.position.kind === "component"
				? next.circuit.components
				: next.circuit.nets
			).some((item) => item.id === drag.position.id)
				? drag
				: null,
		);
		state.setConnectionDrag((drag) =>
			drag &&
			next.circuit.components.some(
				(component) =>
					component.pins.some((pin) => pin.id === drag.pinId) &&
					!(next.graph.collapsedComponentIds ?? []).includes(component.id),
			)
				? drag
				: null,
		);
		state.setEditing((editing) =>
			editing &&
			(editing.kind === "net"
				? next.circuit.nets
				: next.circuit.components
			).some((item) => item.id === editing.id)
				? editing
				: null,
		);
		state.setPendingPin((id) =>
			id &&
			next.circuit.components.some((component) =>
				component.pins.some((pin) => pin.id === id),
			)
				? id
				: null,
		);
	});
}
