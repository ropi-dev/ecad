import {
	type EditorShape,
	symbolShapes,
	type TextShape,
} from "#/drawing/shapes.ts";
import type { Bounds, Point } from "#/drawing/types.ts";
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

interface ElectricalNode {
	point: Point;
	end?: Point;
	wire?: number;
	label?: number;
	name?: string;
	pin?: ElectricalNet["pins"][number];
}
interface SpatialEntry extends Bounds {
	index: number;
}
interface SpatialTree extends Bounds {
	entries?: SpatialEntry[];
	left?: SpatialTree;
	right?: SpatialTree;
}

function spatialTree(entries: SpatialEntry[]): SpatialTree | undefined {
	if (!entries.length) return;
	const bounds = entries.reduce(
		(bounds, entry) => ({
			minX: Math.min(bounds.minX, entry.minX),
			maxX: Math.max(bounds.maxX, entry.maxX),
			minY: Math.min(bounds.minY, entry.minY),
			maxY: Math.max(bounds.maxY, entry.maxY),
		}),
		{ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
	);
	if (entries.length <= 8) return { ...bounds, entries };
	const axis =
		bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY ? "X" : "Y";
	entries.sort(
		(a, b) =>
			a[`min${axis}`] / 2 +
			a[`max${axis}`] / 2 -
			b[`min${axis}`] / 2 -
			b[`max${axis}`] / 2,
	);
	const middle = Math.floor(entries.length / 2);
	return {
		...bounds,
		left: spatialTree(entries.slice(0, middle)),
		right: spatialTree(entries.slice(middle)),
	};
}

function queryPoint(
	tree: SpatialTree | undefined,
	point: Point,
	visit: (index: number) => void,
): void {
	if (
		!tree ||
		point.x < tree.minX - tolerance ||
		point.x > tree.maxX + tolerance ||
		point.y < tree.minY - tolerance ||
		point.y > tree.maxY + tolerance
	)
		return;
	if (tree.entries) {
		for (const entry of tree.entries) {
			if (
				point.x >= entry.minX - tolerance &&
				point.x <= entry.maxX + tolerance &&
				point.y >= entry.minY - tolerance &&
				point.y <= entry.maxY + tolerance
			)
				visit(entry.index);
		}
	} else {
		queryPoint(tree.left, point, visit);
		queryPoint(tree.right, point, visit);
	}
}

export function electricalNets(
	shapes: readonly EditorShape[],
): ElectricalNet[] {
	return measurePerformance(
		"drawing.electrical-nets",
		() => {
			const nodes: ElectricalNode[] = [];
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
			}
			const tree = spatialTree(
				nodes.map((node, index) => ({
					index,
					minX: Math.min(node.point.x, node.end?.x ?? node.point.x),
					maxX: Math.max(node.point.x, node.end?.x ?? node.point.x),
					minY: Math.min(node.point.y, node.end?.y ?? node.point.y),
					maxY: Math.max(node.point.y, node.end?.y ?? node.point.y),
				})),
			);
			for (const [index, node] of nodes.entries()) {
				for (const point of node.end ? [node.point, node.end] : [node.point]) {
					queryPoint(tree, point, (otherIndex) => {
						if (otherIndex === index) return;
						const other = nodes[otherIndex];
						if (
							other.end
								? onSegment(point, other.point, other.end)
								: samePoint(point, other.point)
						)
							join(index, otherIndex);
					});
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
