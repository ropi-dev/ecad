import { isBoardFootprint } from "@ecad/drawing-core/board/footprints.ts";
import type { Circuit, CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import type { CircuitStore } from "@ecad/drawing-core/circuit/store.ts";
import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	type ElectricalNet,
	electricalNets,
	isNetLabel,
} from "@ecad/drawing-core/drawing/named-nets.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	componentShapeIds,
	componentsByShapeId,
	schematicPinLookup,
} from "#/circuit/linked-schematic.ts";

export interface CircuitSelectionItem {
	kind: "component" | "pin" | "net" | "connection";
	id: string;
}
export type CircuitSubject = CircuitSelectionItem & {
	kind: Exclude<CircuitSelectionItem["kind"], "connection">;
};
export interface SchematicSelection {
	shapeIds: readonly number[];
	childKey: string | null;
}
export interface CircuitViewSelection {
	item: CircuitSelectionItem | null;
	checkedPins: readonly string[];
}

type ViewState =
	| {
			view: "schematic" | "pcb";
			store: ReturnType<typeof createDrawingStore>;
			selection: SchematicSelection;
	  }
	| { view: "circuit"; store: CircuitStore; selection: CircuitViewSelection };
export type ViewSelection = ViewState & { origin?: ViewState };

const pinChildPrefix = "shape:";

function circuitNetOf(shapes: readonly EditorShape[], circuit: Circuit) {
	const pinId = schematicPinLookup(circuit.components);
	const netIds = new Set(circuit.nets.map((net) => net.id));
	const pinNets = new Map(
		circuit.nets.flatMap((net) => net.pinIds.map((id) => [id, net.id])),
	);
	const symbolNets = new Map(
		circuit.nets.flatMap((net) =>
			(net.schematicShapeIds ?? []).map((id) => [id, net.id]),
		),
	);
	const shapeById = new Map(shapes.map((shape) => [shape.id, shape]));
	return (group: ElectricalNet): string | undefined => {
		const ids = new Set<string>();
		for (const id of group.labels) {
			const shape = shapeById.get(id);
			if (shape?.kind === "text" && shape.circuitNet)
				if (netIds.has(shape.circuitNet.id)) ids.add(shape.circuitNet.id);
		}
		for (const pin of group.pins) {
			const symbolNet = symbolNets.get(pin.shapeId);
			if (symbolNet) ids.add(symbolNet);
			const id = pinId(pin.shapeId, pin.pinId);
			const net = id === undefined ? undefined : pinNets.get(id);
			if (net) ids.add(net);
		}
		return ids.size === 1 ? [...ids][0] : undefined;
	};
}

function isNetGeometry(shape: EditorShape) {
	return (
		shape.kind === "wire" ||
		isNetLabel(shape) ||
		(shape.kind === "symbol" && shape.netSymbol === true)
	);
}

export function circuitSelectionFromSchematic(
	shapes: readonly EditorShape[],
	file: Pick<CircuitFile, "circuit" | "graph">,
	selection: SchematicSelection,
): CircuitSubject | null {
	const { circuit } = file;
	const shapeById = new Map(shapes.map((shape) => [shape.id, shape]));
	const owners = componentsByShapeId(circuit.components);
	const collapsed = new Set(file.graph.collapsedComponentIds ?? []);
	const netIds = new Set(circuit.nets.map((net) => net.id));
	const subjects = new Map<string, CircuitSubject>();
	const add = (subject: CircuitSubject) =>
		subjects.set(`${subject.kind}:${subject.id}`, subject);
	const netShapes = new Set<number>();
	for (const id of selection.shapeIds) {
		const shape = shapeById.get(id);
		if (!shape) continue;
		const owner = owners.get(id);
		if (owner) {
			const pinId =
				selection.shapeIds.length === 1 &&
				selection.childKey?.startsWith(pinChildPrefix) &&
				!collapsed.has(owner.id)
					? schematicPinLookup(circuit.components)(
							id,
							Number(selection.childKey.slice(pinChildPrefix.length)),
						)
					: undefined;
			add(
				pinId === undefined
					? { kind: "component", id: owner.id }
					: { kind: "pin", id: pinId },
			);
		} else if (
			shape.kind === "text" &&
			shape.circuitNet &&
			netIds.has(shape.circuitNet.id)
		)
			add({ kind: "net", id: shape.circuitNet.id });
		else if (isNetGeometry(shape)) netShapes.add(id);
	}
	if (netShapes.size) {
		const netOf = circuitNetOf(shapes, circuit);
		for (const group of electricalNets(shapes)) {
			if (
				!group.wires.some((id) => netShapes.has(id)) &&
				!group.labels.some((id) => netShapes.has(id)) &&
				!group.pins.some((pin) => netShapes.has(pin.shapeId))
			)
				continue;
			const net = netOf(group);
			if (net) add({ kind: "net", id: net });
		}
	}
	return subjects.size === 1 ? [...subjects.values()][0] : null;
}

export function schematicSelectionFromCircuit(
	shapes: readonly EditorShape[],
	circuit: Circuit,
	selection: CircuitViewSelection,
): SchematicSelection {
	const { item, checkedPins } = selection;
	const existing = new Set(shapes.map((shape) => shape.id));
	const ids = new Set<number>();
	const keep = (id: number | undefined) => {
		if (id !== undefined && existing.has(id)) ids.add(id);
	};
	let childKey: string | null = null;
	if (item?.kind === "component") {
		const component = circuit.components.find(({ id }) => id === item.id);
		for (const id of component ? componentShapeIds(component) : []) keep(id);
	} else if (item?.kind === "pin" || item?.kind === "connection") {
		const pinIds =
			item.kind === "connection" && checkedPins.includes(item.id)
				? checkedPins
				: [item.id];
		let sourcePinId: string | undefined;
		for (const component of circuit.components)
			for (const pin of component.pins)
				if (pinIds.includes(pin.id)) {
					keep(pin.schematicShapeId ?? component.schematicShapeId);
					sourcePinId = pin.sourcePinId;
				}
		if (pinIds.length === 1 && ids.size === 1 && sourcePinId !== undefined)
			childKey = `${pinChildPrefix}${sourcePinId}`;
	} else if (item?.kind === "net") {
		const net = circuit.nets.find(({ id }) => id === item.id);
		if (net) {
			for (const id of net.schematicShapeIds ?? []) keep(id);
			for (const shape of shapes)
				if (shape.kind === "text" && shape.circuitNet?.id === net.id)
					keep(shape.id);
			const netOf = circuitNetOf(shapes, circuit);
			const shapeById = new Map(shapes.map((shape) => [shape.id, shape]));
			for (const group of electricalNets(shapes)) {
				if (netOf(group) !== net.id) continue;
				for (const id of [...group.wires, ...group.labels]) keep(id);
				for (const pin of group.pins) {
					const shape = shapeById.get(pin.shapeId);
					if (shape?.kind === "symbol" && shape.netSymbol) keep(shape.id);
				}
			}
		}
	}
	return { shapeIds: [...ids].sort((a, b) => a - b), childKey };
}

export function componentsOfSchematicSelection(
	circuit: Circuit,
	selection: SchematicSelection,
): string[] {
	const owners = componentsByShapeId(circuit.components);
	return [
		...new Set(
			selection.shapeIds.flatMap((id) => {
				const owner = owners.get(id);
				return owner ? [owner.id] : [];
			}),
		),
	];
}

export function componentsOfCircuitSelection(
	circuit: Circuit,
	{ item, checkedPins }: CircuitViewSelection,
): string[] {
	if (item?.kind === "component") return [item.id];
	if (item?.kind !== "pin" && item?.kind !== "connection") return [];
	const pinIds = new Set(
		item.kind === "connection" && checkedPins.includes(item.id)
			? checkedPins
			: [item.id],
	);
	return circuit.components
		.filter((component) => component.pins.some((pin) => pinIds.has(pin.id)))
		.map((component) => component.id);
}

export function componentsOfBoardSelection(
	shapes: readonly EditorShape[],
	selection: SchematicSelection,
): string[] {
	const selected = new Set(selection.shapeIds);
	return [
		...new Set(
			shapes.flatMap((shape) =>
				selected.has(shape.id) && isBoardFootprint(shape) && shape.component
					? [shape.component]
					: [],
			),
		),
	];
}

export function boardSelectionFromComponents(
	shapes: readonly EditorShape[],
	componentIds: readonly string[],
): SchematicSelection {
	const wanted = new Set(componentIds);
	return {
		shapeIds: shapes
			.filter(
				(shape) =>
					isBoardFootprint(shape) &&
					shape.component !== undefined &&
					wanted.has(shape.component),
			)
			.map((shape) => shape.id)
			.sort((a, b) => a - b),
		childKey: null,
	};
}

export function netOfBoardSelection(
	shapes: readonly EditorShape[],
	circuit: Circuit,
	selection: SchematicSelection,
): string | null {
	if (!selection.shapeIds.length) return null;
	const selected = new Set(selection.shapeIds);
	const netIds = new Set(circuit.nets.map((net) => net.id));
	const foundNets = new Set<string>();
	for (const shape of shapes) {
		if (!selected.has(shape.id)) continue;
		if (isBoardFootprint(shape) && shape.component) return null;
		if ("net" in shape && shape.net && netIds.has(shape.net))
			foundNets.add(shape.net);
	}
	return foundNets.size === 1 ? [...foundNets][0] : null;
}

export function boardSelectionFromNet(
	shapes: readonly EditorShape[],
	netId: string,
): SchematicSelection {
	return {
		shapeIds: shapes
			.filter(
				(shape) =>
					!isBoardFootprint(shape) && "net" in shape && shape.net === netId,
			)
			.map((shape) => shape.id)
			.sort((a, b) => a - b),
		childKey: null,
	};
}

export function schematicSelectionFromComponents(
	shapes: readonly EditorShape[],
	circuit: Circuit,
	componentIds: readonly string[],
): SchematicSelection {
	const existing = new Set(shapes.map((shape) => shape.id));
	const wanted = new Set(componentIds);
	return {
		shapeIds: [
			...new Set(
				circuit.components
					.filter((component) => wanted.has(component.id))
					.flatMap(componentShapeIds)
					.filter((id) => existing.has(id)),
			),
		].sort((a, b) => a - b),
		childKey: null,
	};
}

export function circuitSelectionFromComponents(
	componentIds: readonly string[],
): CircuitViewSelection {
	return {
		item:
			componentIds.length === 1
				? { kind: "component", id: componentIds[0] }
				: null,
		checkedPins: [],
	};
}

export function sameSchematicSelection(
	a: SchematicSelection,
	b: SchematicSelection,
) {
	return (
		a.childKey === b.childKey &&
		a.shapeIds.length === b.shapeIds.length &&
		a.shapeIds.every((id, index) => id === b.shapeIds[index])
	);
}

export function sameCircuitSelection(
	a: CircuitViewSelection,
	b: CircuitViewSelection,
) {
	return (
		a.item?.kind === b.item?.kind &&
		a.item?.id === b.item?.id &&
		a.checkedPins.length === b.checkedPins.length &&
		a.checkedPins.every((id, index) => id === b.checkedPins[index])
	);
}

export function pruneCircuitSelection(
	file: Pick<CircuitFile, "circuit" | "graph">,
	selection: CircuitViewSelection,
): CircuitViewSelection {
	const { circuit } = file;
	const collapsed = new Set(file.graph.collapsedComponentIds ?? []);
	const visiblePins = new Set(
		circuit.components.flatMap((component) =>
			collapsed.has(component.id) ? [] : component.pins.map((pin) => pin.id),
		),
	);
	const connected = new Set(circuit.nets.flatMap((net) => net.pinIds));
	const isConnection = (id: string) => visiblePins.has(id) && connected.has(id);
	const { item } = selection;
	if (item?.kind === "connection") {
		const checkedPins = selection.checkedPins.filter(isConnection);
		return checkedPins.includes(item.id)
			? { item, checkedPins }
			: { item: null, checkedPins: [] };
	}
	const exists =
		item?.kind === "component"
			? circuit.components.some((component) => component.id === item.id)
			: item?.kind === "net"
				? circuit.nets.some((net) => net.id === item.id)
				: item?.kind === "pin" && visiblePins.has(item.id);
	return { item: exists ? item : null, checkedPins: [] };
}
