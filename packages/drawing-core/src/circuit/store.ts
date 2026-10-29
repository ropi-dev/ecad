import { measurePerformance } from "#/performance/runtime.ts";
import {
	type CircuitComponent,
	type CircuitFile,
	type CircuitNet,
	circuitFileSchema,
	createCircuit,
	type GraphLayout,
} from "./model.ts";

export type CircuitCommand =
	| {
			type: "add-component";
			component: CircuitComponent;
			position?: { x: number; y: number };
	  }
	| { type: "update-component"; id: string; reference: string; value: string }
	| { type: "remove-component"; id: string }
	| { type: "add-net"; net: CircuitNet; position?: { x: number; y: number } }
	| { type: "remove-net"; id: string }
	| { type: "connect"; pinIds: string[]; netId?: string }
	| { type: "disconnect"; pinIds: string[] }
	| { type: "split-net"; netId: string; pinIds: string[] }
	| { type: "rename-net"; id: string; names: string[] }
	| { type: "no-connect"; pinId: string; enabled: boolean }
	| { type: "move"; positions: GraphLayout["positions"] }
	| { type: "set-component-collapsed"; id: string; collapsed: boolean }
	| { type: "replace"; file: CircuitFile };

function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

export function applyCircuitCommand(
	current: CircuitFile,
	command: CircuitCommand,
): CircuitFile {
	if (command.type === "replace") {
		if (command.file.circuit.id !== current.circuit.id)
			throw new Error("Replacing contents must preserve the circuit identity.");
		return circuitFileSchema.parse(command.file);
	}
	const file = structuredClone(current);
	const { circuit, graph } = file;
	const pins = new Set(
		circuit.components.flatMap((component) =>
			component.pins.map((pin) => pin.id),
		),
	);
	const requirePins = (pinIds: string[]) => {
		if (
			!pinIds.length ||
			new Set(pinIds).size !== pinIds.length ||
			pinIds.some((id) => !pins.has(id))
		)
			throw new Error("Choose distinct pins belonging to this circuit.");
	};
	const detach = (pinIds: Set<string>) => {
		circuit.nets = circuit.nets.map((net) => ({
			...net,
			pinIds: net.pinIds.filter((id) => !pinIds.has(id)),
		}));
	};
	switch (command.type) {
		case "set-component-collapsed": {
			if (!circuit.components.some((component) => component.id === command.id))
				throw new Error("Component no longer exists.");
			const collapsed = new Set(graph.collapsedComponentIds ?? []);
			if (command.collapsed) collapsed.add(command.id);
			else collapsed.delete(command.id);
			if (collapsed.size) graph.collapsedComponentIds = [...collapsed];
			else delete graph.collapsedComponentIds;
			break;
		}
		case "add-component":
			circuit.components.push(command.component);
			if (command.position)
				graph.positions.push({
					id: command.component.id,
					kind: "component",
					x: command.position.x,
					y: command.position.y,
				});
			break;
		case "add-net":
			circuit.nets.push(command.net);
			if (command.position)
				graph.positions.push({
					id: command.net.id,
					kind: "net",
					x: command.position.x,
					y: command.position.y,
				});
			break;
		case "remove-net":
			if (!circuit.nets.some((net) => net.id === command.id))
				throw new Error("Net no longer exists.");
			circuit.nets = circuit.nets.filter((net) => net.id !== command.id);
			break;
		case "update-component": {
			const component = circuit.components.find(
				(component) => component.id === command.id,
			);
			if (!component) throw new Error("Component no longer exists.");
			component.reference = command.reference;
			component.value = command.value;
			break;
		}
		case "remove-component": {
			const component = circuit.components.find(
				(component) => component.id === command.id,
			);
			if (!component) throw new Error("Component no longer exists.");
			const removed = new Set(component.pins.map((pin) => pin.id));
			circuit.components = circuit.components.filter(
				(component) => component.id !== command.id,
			);
			detach(removed);
			circuit.noConnectPinIds = circuit.noConnectPinIds.filter(
				(id) => !removed.has(id),
			);
			break;
		}
		case "connect": {
			requirePins(command.pinIds);
			const selected = new Set(command.pinIds);
			const target = command.netId
				? circuit.nets.find((net) => net.id === command.netId)
				: undefined;
			if (command.netId && !target) throw new Error("Net no longer exists.");
			const joined = circuit.nets.filter(
				(net) => net === target || net.pinIds.some((id) => selected.has(id)),
			);
			const survivor = target ?? joined[0];
			const memberIds = [
				...new Set([...joined.flatMap((net) => net.pinIds), ...command.pinIds]),
			];
			const joinedIds = new Set(joined.map((net) => net.id));
			circuit.nets = circuit.nets.filter((net) => !joinedIds.has(net.id));
			circuit.nets.push({
				id: survivor?.id ?? globalThis.crypto.randomUUID(),
				names: [
					...new Set([
						...(target?.names ?? []),
						...joined.flatMap((net) => net.names),
					]),
				],
				pinIds: memberIds,
			});
			circuit.noConnectPinIds = circuit.noConnectPinIds.filter(
				(id) => !memberIds.includes(id),
			);
			break;
		}
		case "disconnect":
			requirePins(command.pinIds);
			detach(new Set(command.pinIds));
			break;
		case "split-net": {
			requirePins(command.pinIds);
			const net = circuit.nets.find((net) => net.id === command.netId);
			if (
				!net ||
				command.pinIds.length >= net.pinIds.length ||
				command.pinIds.some((id) => !net.pinIds.includes(id))
			)
				throw new Error("Select some, but not all, pins of one net to split.");
			detach(new Set(command.pinIds));
			circuit.nets.push({
				id: globalThis.crypto.randomUUID(),
				names: [],
				pinIds: command.pinIds,
			});
			break;
		}
		case "rename-net": {
			const net = circuit.nets.find((net) => net.id === command.id);
			if (!net) throw new Error("Net no longer exists.");
			net.names = command.names;
			break;
		}
		case "no-connect": {
			requirePins([command.pinId]);
			circuit.noConnectPinIds = circuit.noConnectPinIds.filter(
				(id) => id !== command.pinId,
			);
			if (command.enabled) {
				detach(new Set([command.pinId]));
				circuit.noConnectPinIds.push(command.pinId);
			}
			break;
		}
		case "move": {
			const moved = new Set(command.positions.map((position) => position.id));
			const entities = new Map([
				...circuit.components.map(
					(component) => [component.id, "component"] as const,
				),
				...circuit.nets.map((net) => [net.id, "net"] as const),
			]);
			if (
				moved.size !== command.positions.length ||
				command.positions.some(
					(position) => entities.get(position.id) !== position.kind,
				)
			)
				throw new Error(
					"Choose distinct graph nodes belonging to this circuit.",
				);
			graph.positions = [
				...graph.positions.filter((position) => !moved.has(position.id)),
				...command.positions,
			];
			break;
		}
	}
	const components = new Set(
		circuit.components.map((component) => component.id),
	);
	const nets = new Set(circuit.nets.map((net) => net.id));
	graph.positions = graph.positions.filter((position) =>
		(position.kind === "component" ? components : nets).has(position.id),
	);
	if (graph.collapsedComponentIds) {
		const collapsed = graph.collapsedComponentIds.filter((id) =>
			components.has(id),
		);
		if (collapsed.length) graph.collapsedComponentIds = collapsed;
		else delete graph.collapsedComponentIds;
	}
	if (command.type !== "move" && command.type !== "set-component-collapsed")
		circuit.revision++;
	return circuitFileSchema.parse(file);
}

export function createCircuitStore(
	initial = createCircuit("Untitled circuit"),
) {
	let file = freeze(circuitFileSchema.parse(initial));
	let past: CircuitFile[] = [];
	let future: CircuitFile[] = [];
	let snapshot = { ...file, canUndo: false, canRedo: false };
	const listeners = new Set<() => void>();
	const publish = () => {
		snapshot = freeze({
			...file,
			canUndo: past.length > 0,
			canRedo: future.length > 0,
		});
		for (const listener of listeners) listener();
	};
	return {
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		synchronize(
			next: CircuitFile,
			options: { preserveHistory?: boolean } = {},
		) {
			if (next.circuit.id !== file.circuit.id)
				throw new Error("Synchronization must preserve the circuit identity.");
			file = freeze(circuitFileSchema.parse(next));
			if (!options.preserveHistory) {
				past = [];
				future = [];
			}
			publish();
		},
		execute(command: CircuitCommand) {
			const next = measurePerformance(
				"circuit.edit",
				() => freeze(applyCircuitCommand(file, command)),
				{
					components: file.circuit.components.length,
					nets: file.circuit.nets.length,
				},
			);
			past = [...past.slice(-99), file];
			future = [];
			file = next;
			publish();
		},
		undo() {
			const previous = past.at(-1);
			if (!previous) return;
			future = [...future, file];
			past = past.slice(0, -1);
			file = previous;
			publish();
		},
		redo() {
			const next = future.at(-1);
			if (!next) return;
			past = [...past, file];
			future = future.slice(0, -1);
			file = next;
			publish();
		},
	};
}
export type CircuitStore = ReturnType<typeof createCircuitStore>;
