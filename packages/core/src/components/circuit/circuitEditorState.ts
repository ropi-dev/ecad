import type { buildCircuitGraph } from "@ecad/drawing-core/circuit/graph.ts";
import type { GraphLayout } from "@ecad/drawing-core/circuit/model.ts";
import type {
	CircuitCommand,
	CircuitStore,
} from "@ecad/drawing-core/circuit/store.ts";
import {
	type Dispatch,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	type SetStateAction,
	useEffect,
} from "react";

export type CircuitSelection = {
	kind: "component" | "pin" | "net" | "connection";
	id: string;
} | null;
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

/** Editor commands the graph's nodes and connections call. */
export interface CircuitGraphActions {
	select(next: CircuitSelection): void;
	edit(item: NonNullable<CircuitSelection>): void;
	finishEditing(): void;
	openMenu(
		event: ReactMouseEvent<HTMLButtonElement>,
		item: NonNullable<CircuitSelection>,
	): void;
	selectPin(id: string): void;
	selectNet(id: string): void;
	selectConnection(id: string, additive: boolean): void;
	startDrag(
		event: ReactPointerEvent<HTMLButtonElement>,
		position: CircuitPosition,
	): void;
	startConnectionDrag(
		event: ReactPointerEvent<HTMLButtonElement>,
		pinId: string,
	): void;
	run(command: CircuitCommand): boolean;
	snap<T extends { x: number; y: number }>(position: T): T;
}

/**
 * Drops gestures, selections and edits whose component, pin or net no longer
 * exists after the circuit changes, for example after undo or a sync from the
 * schematic. Pins on collapsed components count as gone.
 */
export function usePruneToSnapshot(
	snapshot: ReturnType<CircuitStore["getSnapshot"]>,
	{
		setDrag,
		setConnectionDrag,
		setCheckedPins,
		setSelection,
		setEditing,
		setPendingPin,
	}: {
		setDrag: Dispatch<SetStateAction<CircuitDrag | null>>;
		setConnectionDrag: Dispatch<SetStateAction<ConnectionDrag | null>>;
		setCheckedPins: Dispatch<SetStateAction<string[]>>;
		setSelection: Dispatch<SetStateAction<CircuitSelection>>;
		setEditing: Dispatch<SetStateAction<CircuitSelection>>;
		setPendingPin: Dispatch<SetStateAction<string | null>>;
	},
) {
	useEffect(() => {
		setDrag((current) =>
			current &&
			(current.position.kind === "component"
				? snapshot.circuit.components
				: snapshot.circuit.nets
			).some((item) => item.id === current.position.id)
				? current
				: null,
		);
		setConnectionDrag((current) =>
			current &&
			snapshot.circuit.components.some(
				(component) =>
					component.pins.some((pin) => pin.id === current.pinId) &&
					!(snapshot.graph.collapsedComponentIds ?? []).includes(component.id),
			)
				? current
				: null,
		);
		setCheckedPins([]);
		setSelection((current) => {
			if (!current) return null;
			if (current.kind === "connection") return null;
			const exists =
				current.kind === "net"
					? snapshot.circuit.nets.some((net) => net.id === current.id)
					: current.kind === "component"
						? snapshot.circuit.components.some(
								(component) => component.id === current.id,
							)
						: snapshot.circuit.components.some(
								(component) =>
									component.pins.some((pin) => pin.id === current.id) &&
									!(snapshot.graph.collapsedComponentIds ?? []).includes(
										component.id,
									),
							);
			return exists ? current : null;
		});
		setEditing((current) =>
			current &&
			(current.kind === "net"
				? snapshot.circuit.nets
				: snapshot.circuit.components
			).some((item) => item.id === current.id)
				? current
				: null,
		);
		setPendingPin((id) =>
			id &&
			snapshot.circuit.components.some((component) =>
				component.pins.some((pin) => pin.id === id),
			)
				? id
				: null,
		);
	}, [
		snapshot,
		setDrag,
		setConnectionDrag,
		setCheckedPins,
		setSelection,
		setEditing,
		setPendingPin,
	]);
}
