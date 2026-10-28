import {
	type EditorShape,
	symbolShapes,
	type TextShape,
} from "#/drawing/shapes.ts";
import type { Point } from "#/drawing/types.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export interface ElectricalNet {
	names: string[];
	wires: number[];
	labels: number[];
	pins: { shapeId: number; pinId: number }[];
}

export function isNetLabel(
	shape: EditorShape,
): shape is TextShape & { electrical: "net" | "supply" } {
	return (
		shape.kind === "text" &&
		(shape.electrical === "net" || shape.electrical === "supply")
	);
}

const tolerance = 1e-4;
const samePoint = (a: Point, b: Point) =>
	Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
function onSegment(point: Point, start: Point, end: Point) {
	const dx = end.x - start.x,
		dy = end.y - start.y;
	const lengthSquared = dx * dx + dy * dy;
	if (!lengthSquared) return samePoint(point, start);
	const t = Math.max(
		0,
		Math.min(
			1,
			((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
		),
	);
	return samePoint(point, { x: start.x + t * dx, y: start.y + t * dy });
}

export function electricalNets(
	shapes: readonly EditorShape[],
): ElectricalNet[] {
	return measurePerformance(
		"drawing.electrical-nets",
		() => {
			const nodes: {
				point: Point;
				end?: Point;
				wire?: number;
				label?: number;
				name?: string;
				pin?: ElectricalNet["pins"][number];
			}[] = [];
			for (const shape of shapes) {
				if (shape.kind === "wire")
					nodes.push({
						point: {
							x: shape.x - (Math.cos(shape.rotation) * shape.width) / 2,
							y: shape.y - (Math.sin(shape.rotation) * shape.width) / 2,
						},
						end: {
							x: shape.x + (Math.cos(shape.rotation) * shape.width) / 2,
							y: shape.y + (Math.sin(shape.rotation) * shape.width) / 2,
						},
						wire: shape.id,
					});
				else if (isNetLabel(shape) && shape.text.trim())
					nodes.push({
						point: shape,
						label: shape.id,
						name: shape.text.trim(),
					});
				else if (shape.kind === "pin")
					nodes.push({
						point: shape,
						pin: { shapeId: shape.id, pinId: shape.id },
					});
				else if (shape.kind === "symbol") {
					for (const child of symbolShapes(shape)) {
						if (child.kind === "pin")
							nodes.push({
								point: child,
								pin: { shapeId: shape.id, pinId: child.id },
							});
					}
				}
			}
			const parents = nodes.map((_, index) => index);
			const root = (index: number): number => {
				while (parents[index] !== index) {
					parents[index] = parents[parents[index]];
					index = parents[index];
				}
				return index;
			};
			const join = (a: number, b: number) => {
				parents[root(a)] = root(b);
			};
			const names = new Map<string, number>();
			for (const [index, node] of nodes.entries()) {
				if (node.name) {
					const previous = names.get(node.name);
					if (previous !== undefined) join(index, previous);
					names.set(node.name, index);
				}
				for (let otherIndex = 0; otherIndex < index; otherIndex++) {
					const other = nodes[otherIndex];
					if (
						samePoint(node.point, other.point) ||
						(node.end && onSegment(other.point, node.point, node.end)) ||
						(other.end && onSegment(node.point, other.point, other.end)) ||
						(node.end &&
							other.end &&
							(onSegment(node.end, other.point, other.end) ||
								onSegment(other.end, node.point, node.end)))
					)
						join(index, otherIndex);
				}
			}
			const groups = new Map<number, ElectricalNet>();
			for (const [index, node] of nodes.entries()) {
				const key = root(index);
				const net = groups.get(key) ?? {
					names: [],
					wires: [],
					labels: [],
					pins: [],
				};
				if (node.wire !== undefined) net.wires.push(node.wire);
				if (node.label !== undefined) net.labels.push(node.label);
				if (node.pin) net.pins.push(node.pin);
				if (node.name && !net.names.includes(node.name))
					net.names.push(node.name);
				groups.set(key, net);
			}
			return [...groups.values()].map((net) => ({
				...net,
				names: net.names.sort(),
			}));
		},
		{ shapes: shapes.length },
	);
}

export function indexElectricalNets(
	shapes: readonly EditorShape[],
): Map<number, ReadonlySet<number>> {
	const index = new Map<number, Set<number>>();
	for (const net of electricalNets(shapes)) {
		const ids = new Set([
			...net.wires,
			...net.labels,
			...net.pins.map((pin) => pin.shapeId),
		]);
		for (const id of ids) {
			const members = index.get(id) ?? new Set<number>();
			for (const member of ids) members.add(member);
			index.set(id, members);
		}
	}
	return index;
}
