import type { Circuit, CircuitComponent } from "#/circuit/model.ts";
import { circuitNetLabels } from "#/circuit/net-labels.ts";

interface BoardNet {
	id: string;
	name: string;
}

export interface BoardNetlist {
	nets: ReadonlyMap<string, BoardNet>;
	components: ReadonlyMap<string, CircuitComponent>;
	/** The net of a component pin, found by its package number. */
	padNet(component: string | undefined, number: string): string | undefined;
}

const emptyNetlist: BoardNetlist = {
	nets: new Map(),
	components: new Map(),
	padNet: () => undefined,
};

const netlists = new WeakMap<Circuit, BoardNetlist>();

export function boardNetlist(circuit: Circuit | undefined): BoardNetlist {
	if (!circuit) return emptyNetlist;
	const cached = netlists.get(circuit);
	if (cached) return cached;
	const labels = circuitNetLabels(circuit);
	const netOfPin = new Map<string, string>();
	for (const net of circuit.nets)
		for (const pinId of net.pinIds) netOfPin.set(pinId, net.id);
	const byPad = new Map<string, string>();
	for (const component of circuit.components)
		for (const pin of component.pins) {
			const net = netOfPin.get(pin.id);
			if (net) byPad.set(`${component.id}\u0000${pin.number}`, net);
		}
	const netlist: BoardNetlist = {
		nets: new Map(
			circuit.nets.map((net) => [
				net.id,
				{ id: net.id, name: labels.get(net.id) ?? net.id },
			]),
		),
		components: new Map(
			circuit.components.map((component) => [component.id, component]),
		),
		padNet: (component, number) =>
			component === undefined
				? undefined
				: byPad.get(`${component}\u0000${number}`),
	};
	netlists.set(circuit, netlist);
	return netlist;
}

export const netName = (netlist: BoardNetlist, net: string | undefined) =>
	net === undefined ? "No net" : (netlist.nets.get(net)?.name ?? "Missing net");
