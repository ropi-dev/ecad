import { connectionTolerance } from "#/drawing/connection-geometry.ts";
import { pageKey } from "#/drawing/pages.ts";
import type { EditorShape, TextShape } from "#/drawing/schema.ts";
import { symbolShapes } from "#/drawing/symbol-instances.ts";
import type { Bounds, Point } from "#/drawing/types.ts";
import { unionFind } from "#/lib/union-find.ts";
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

const samePoint = (a: Point, b: Point) =>
	Math.hypot(a.x - b.x, a.y - b.y) <= connectionTolerance;
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
	/** Contacts join nodes on one page; names join nodes on every page. */
	page: number;
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

const CELL = 5;
const cellOf = (value: number) => Math.floor(value / CELL);
const cellKey = (x: number, y: number) => x * 1e6 + y;

function spatialIndex(entries: readonly SpatialEntry[]) {
	const cells = new Map<number, SpatialEntry[]>();
	const wide: SpatialEntry[] = [];
	for (const entry of entries) {
		const left = cellOf(entry.minX - connectionTolerance);
		const right = cellOf(entry.maxX + connectionTolerance);
		const bottom = cellOf(entry.minY - connectionTolerance);
		const top = cellOf(entry.maxY + connectionTolerance);
		if (
			!Number.isFinite(left + right + bottom + top) ||
			(right - left + 1) * (top - bottom + 1) > 64
		) {
			wide.push(entry);
			continue;
		}
		for (let x = left; x <= right; x++)
			for (let y = bottom; y <= top; y++) {
				const key = cellKey(x, y);
				const cell = cells.get(key);
				if (cell) cell.push(entry);
				else cells.set(key, [entry]);
			}
	}
	const contains = (entry: SpatialEntry, point: Point) =>
		point.x >= entry.minX - connectionTolerance &&
		point.x <= entry.maxX + connectionTolerance &&
		point.y >= entry.minY - connectionTolerance &&
		point.y <= entry.maxY + connectionTolerance;
	return (point: Point, visit: (index: number) => void) => {
		const cell = cells.get(cellKey(cellOf(point.x), cellOf(point.y)));
		if (cell)
			for (const entry of cell) if (contains(entry, point)) visit(entry.index);
		for (const entry of wide) if (contains(entry, point)) visit(entry.index);
	};
}

export function electricalNets(
	shapes: readonly EditorShape[],
): ElectricalNet[] {
	return measurePerformance(
		"drawing.electrical-nets",
		() => {
			const nodes: ElectricalNode[] = [];
			for (const shape of shapes) {
				const page = pageKey(shape);
				if (shape.kind === "wire")
					nodes.push({
						page,
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
						page,
						point: shape,
						label: shape.id,
						name: shape.text.trim(),
					});
				else if (shape.kind === "pin")
					nodes.push({
						page,
						point: shape,
						pin: { shapeId: shape.id, pinId: shape.id },
					});
				else if (shape.kind === "symbol") {
					const name = shape.netSymbol
						? shape.attributes.name.trim()
						: undefined;
					for (const child of symbolShapes(shape)) {
						if (child.kind === "pin")
							nodes.push({
								page,
								point: child,
								pin: { shapeId: shape.id, pinId: child.id },
								...(name ? { name } : {}),
							});
					}
				}
			}
			const sets = unionFind(nodes.length);
			const names = new Map<string, number>();
			for (const [index, node] of nodes.entries()) {
				if (node.name) {
					const previous = names.get(node.name);
					if (previous !== undefined) sets.union(index, previous);
					names.set(node.name, index);
				}
			}
			const query = spatialIndex(
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
					query(point, (otherIndex) => {
						if (otherIndex === index) return;
						const other = nodes[otherIndex];
						if (other.page !== node.page) return;
						if (
							other.end
								? onSegment(point, other.point, other.end)
								: samePoint(point, other.point)
						)
							sets.union(index, otherIndex);
					});
				}
			}
			const groups = new Map<number, ElectricalNet>();
			for (const [index, node] of nodes.entries()) {
				const key = sets.find(index);
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
