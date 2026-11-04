import { measurePerformance } from "#/performance/runtime.ts";
import { snapCircuitPoint } from "./grid.ts";
import type { CircuitFile, GraphLayout } from "./model.ts";
import { circuitNetLabels } from "./net-labels.ts";

export const componentWidth = 200;
export const componentHeight = (pinCount: number) => 116 + pinCount * 30;
/** Rendered width of a net node, which grows with its label up to 360. */
export const netNodeWidth = (label: string) =>
	Math.max(100, Math.min(360, label.length * 8 + 16));
/** A net node's rendered box relative to its anchor; the label sits above the anchor. */
export const netNodeBox = (label: string) => {
	const width = netNodeWidth(label);
	return { x: -width / 2, y: -40, width, height: 60 };
};
/** Horizontal distance from a connection's endpoint to its Bézier control point. */
export const connectionCurveOffset = 65;

export function buildCircuitGraph(file: CircuitFile) {
	return measurePerformance(
		"circuit.graph",
		() => {
			const saved = new Map(
				file.graph.positions.map((position) => [position.id, position]),
			);
			const collapsedIds = new Set(file.graph.collapsedComponentIds ?? []);
			const labels = circuitNetLabels(file.circuit);
			const nets = file.circuit.nets.map((net, index) => {
				const position =
					saved.get(net.id) ??
					snapCircuitPoint({
						x: 330 + (index % 4) * 340,
						y: 95 + Math.floor(index / 4) * 72,
					});
				return {
					...position,
					id: net.id,
					net,
					label: labels.get(net.id) ?? `Net ${index + 1}`,
				};
			});
			const pinNets = new Map(
				nets.flatMap((net) => net.net.pinIds.map((id) => [id, net] as const)),
			);
			const pinNodes = new Map<
				string,
				{ x: number; y: number; componentId: string; side: "left" | "right" }
			>();
			let rowY = 60;
			let rowHeight = 0;
			const components = file.circuit.components.map((component, index) => {
				const collapsed = collapsedIds.has(component.id);
				const visiblePins = collapsed ? [] : component.pins;
				const height = collapsed ? 84 : componentHeight(visiblePins.length);
				if (index % 4 === 0 && index > 0) {
					rowY += rowHeight + 140;
					rowHeight = 0;
				}
				rowHeight = Math.max(rowHeight, height);
				const position =
					saved.get(component.id) ??
					snapCircuitPoint({
						x: 60 + (index % 4) * 340,
						y: rowY,
					});
				const connectionSides = new Set<"left" | "right">();
				component.pins.forEach((pin, pinIndex) => {
					const net = pinNets.get(pin.id);
					const side =
						net && net.x < position.x + componentWidth / 2 ? "left" : "right";
					if (net) connectionSides.add(side);
					pinNodes.set(pin.id, {
						x: position.x + (side === "left" ? 0 : componentWidth),
						y: position.y + (collapsed ? 32 : 84 + pinIndex * 30),
						componentId: component.id,
						side,
					});
				});
				return {
					...position,
					id: component.id,
					height,
					collapsed,
					connectionSides: [...connectionSides],
					visiblePins,
					hiddenPinCount: component.pins.length - visiblePins.length,
					component,
				};
			});
			const edges = nets.flatMap((net) =>
				net.net.pinIds.map((pinId) => ({
					pinId,
					netId: net.id,
					pin: requiredPin(pinNodes, pinId),
					net: { x: net.x, y: net.y },
				})),
			);
			return { components, nets, edges, pinNodes };
		},
		{
			components: file.circuit.components.length,
			nets: file.circuit.nets.length,
		},
	);
}

export function arrangeCircuitGraph(
	file: CircuitFile,
): GraphLayout["positions"] {
	const positions: GraphLayout["positions"] = [];
	const nodes = buildCircuitGraph(file).components;
	let y = 60;
	for (let start = 0; start < nodes.length; start += 4) {
		const row = nodes.slice(start, start + 4);
		row.forEach(({ component }, index) => {
			positions.push({
				id: component.id,
				kind: "component",
				x: 60 + index * 340,
				y,
			});
		});
		y += Math.max(...row.map((node) => node.height)) + 140;
	}
	const positionsById = new Map(
		positions.map((position) => [position.id, position]),
	);
	const pins = new Map<string, { x: number; y: number }>();
	for (const { component, collapsed } of nodes) {
		const position = positionsById.get(component.id);
		if (!position) throw new Error("Missing component position.");
		component.pins.forEach((pin, index) => {
			pins.set(pin.id, {
				x: position.x + 270,
				y: position.y + (collapsed ? 32 : 84 + index * 30),
			});
		});
	}
	const occupied = new Set<string>();
	let emptyNetIndex = 0;
	for (const net of file.circuit.nets) {
		const members = net.pinIds.map((id) => requiredPin(pins, id));
		if (!members.length) {
			positions.push({
				id: net.id,
				kind: "net",
				x: 330 + (emptyNetIndex % 4) * 240,
				y: y + 60 + Math.floor(emptyNetIndex / 4) * 80,
			});
			emptyNetIndex++;
			continue;
		}
		const averageX =
			members.reduce((sum, pin) => sum + pin.x, 0) / members.length;
		const x = 330 + Math.round((averageX - 330) / 340) * 340;
		let netY = Math.round(
			members.reduce((sum, pin) => sum + pin.y, 0) / members.length,
		);
		while (occupied.has(`${x}:${Math.round(netY / 48)}`)) netY += 48;
		occupied.add(`${x}:${Math.round(netY / 48)}`);
		positions.push({ id: net.id, kind: "net", x, y: netY });
	}
	return positions.map((position) => snapCircuitPoint(position));
}

function requiredPin<T>(pins: Map<string, T>, id: string): T {
	const pin = pins.get(id);
	if (!pin) throw new Error("Graph references an unknown pin.");
	return pin;
}
