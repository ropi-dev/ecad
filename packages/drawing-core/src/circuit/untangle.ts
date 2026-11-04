import {
	buildCircuitGraph,
	componentWidth,
	connectionCurveOffset,
	netNodeBox,
	netNodeWidth,
} from "#/circuit/graph.ts";
import { CIRCUIT_GRID_SPACING, snapCircuitPoint } from "#/circuit/grid.ts";
import type { Circuit, CircuitFile, GraphLayout } from "#/circuit/model.ts";
import { measurePerformance } from "#/performance/runtime.ts";

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
type Graph = ReturnType<typeof buildCircuitGraph>;

const intersects = (a: Box, b: Box) =>
	a.x < b.x + b.width &&
	a.x + a.width > b.x &&
	a.y < b.y + b.height &&
	a.y + a.height > b.y;
/** A net node's rendered box plus the clearance the layout keeps around it. */
const netClearance = (x: number, y: number, label: string): Box => {
	const box = netNodeBox(label);
	return {
		x: x + box.x - 12,
		y: y + box.y - 4,
		width: box.width + 24,
		height: box.height + 12,
	};
};
const orientation = (a: Point, b: Point, c: Point) =>
	(b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const crosses = (a: Point, b: Point, c: Point, d: Point) =>
	orientation(a, b, c) * orientation(a, b, d) < 0 &&
	orientation(c, d, a) * orientation(c, d, b) < 0;

function score(graph: Graph) {
	const boxes: Box[] = [
		...graph.components.map((node) => ({
			x: node.x - 12,
			y: node.y - 12,
			width: componentWidth + 24,
			height: node.height + 24,
		})),
		...graph.nets.map((node) => netClearance(node.x, node.y, node.label)),
	];
	let overlaps = 0;
	for (let first = 0; first < boxes.length; first++)
		for (let second = first + 1; second < boxes.length; second++)
			if (intersects(boxes[first], boxes[second])) overlaps++;
	const paths = graph.edges.map((edge) => {
		const direction =
			edge.pin.side === "left" ? -connectionCurveOffset : connectionCurveOffset;
		const points = Array.from({ length: 5 }, (_, index) => {
			const t = index / 4,
				u = 1 - t;
			return {
				x:
					u * u * u * edge.pin.x +
					3 * u * u * t * (edge.pin.x + direction) +
					3 * u * t * t * (edge.net.x - direction) +
					t * t * t * edge.net.x,
				y:
					u * u * u * edge.pin.y +
					3 * u * u * t * edge.pin.y +
					3 * u * t * t * edge.net.y +
					t * t * t * edge.net.y,
			};
		});
		return {
			netId: edge.netId,
			componentId: edge.pin.componentId,
			points,
			box: {
				x: Math.min(...points.map((p) => p.x)),
				y: Math.min(...points.map((p) => p.y)),
				width:
					Math.max(...points.map((p) => p.x)) -
					Math.min(...points.map((p) => p.x)) +
					1,
				height:
					Math.max(...points.map((p) => p.y)) -
					Math.min(...points.map((p) => p.y)) +
					1,
			},
		};
	});
	let crossings = 0;
	for (let first = 0; first < paths.length; first++)
		for (let second = first + 1; second < paths.length; second++) {
			const a = paths[first],
				b = paths[second];
			if (a.netId === b.netId || !intersects(a.box, b.box)) continue;
			let crossing = false;
			for (let i = 0; i < 4 && !crossing; i++)
				for (let j = 0; j < 4; j++)
					if (
						crosses(a.points[i], a.points[i + 1], b.points[j], b.points[j + 1])
					) {
						crossing = true;
						break;
					}
			if (crossing) crossings++;
		}
	let obstructions = 0;
	for (const path of paths)
		for (const node of graph.components) {
			if (node.id === path.componentId) continue;
			const box = {
				x: node.x + 4,
				y: node.y + 4,
				width: componentWidth - 8,
				height: node.height - 8,
			};
			if (!intersects(path.box, box)) continue;
			const corners = [
				{ x: box.x, y: box.y },
				{ x: box.x + box.width, y: box.y },
				{ x: box.x + box.width, y: box.y + box.height },
				{ x: box.x, y: box.y + box.height },
			];
			if (
				path.points.some(
					(point) =>
						point.x > box.x &&
						point.x < box.x + box.width &&
						point.y > box.y &&
						point.y < box.y + box.height,
				) ||
				path.points
					.slice(1)
					.some((point, index) =>
						corners.some((corner, side) =>
							crosses(
								path.points[index],
								point,
								corner,
								corners[(side + 1) % 4],
							),
						),
					)
			)
				obstructions++;
		}
	const length = graph.edges.reduce(
		(total, edge) =>
			total + Math.hypot(edge.pin.x - edge.net.x, edge.pin.y - edge.net.y),
		0,
	);
	return { overlaps, obstructions, crossings, length };
}

function better(a: ReturnType<typeof score>, b: ReturnType<typeof score>) {
	return a.overlaps !== b.overlaps
		? a.overlaps < b.overlaps
		: a.obstructions !== b.obstructions
			? a.obstructions < b.obstructions
			: a.crossings !== b.crossings
				? a.crossings < b.crossings
				: a.length < b.length;
}

export function circuitLayoutQuality(file: CircuitFile) {
	return score(buildCircuitGraph(file));
}

export function untangleCircuitGraph(
	file: CircuitFile,
	step = CIRCUIT_GRID_SPACING,
): GraphLayout["positions"] {
	return measurePerformance(
		"circuit.untangle",
		() => {
			const graph = buildCircuitGraph(file);
			const components = new Map(
				graph.components.map((node) => [node.id, node]),
			);
			const owners = new Map(
				file.circuit.components.flatMap((component) =>
					component.pins.map((pin) => [pin.id, component.id] as const),
				),
			);
			const memberships = new Map(
				file.circuit.nets.map((net) => [
					net.id,
					[
						...new Set(
							net.pinIds.map((id) => {
								const owner = owners.get(id);
								if (!owner) throw new Error("Missing pin owner.");
								return owner;
							}),
						),
					],
				]),
			);
			const componentNets = new Map<string, string[]>(
				graph.components.map((node) => [node.id, []]),
			);
			for (const [netId, members] of memberships)
				for (const id of members) componentNets.get(id)?.push(netId);
			const initial = graph.components.map((node) => node.id);
			const orders: string[][] = [];
			const signatures = new Set<string>();
			function addOrder(order: string[]) {
				const key = JSON.stringify(order);
				if (!signatures.has(key)) {
					signatures.add(key);
					orders.push(order);
				}
			}
			for (const seed of [initial, [...initial].reverse()]) {
				let order = seed;
				addOrder(order);
				for (let sweep = 0; sweep < 4; sweep++) {
					const ranks = new Map(order.map((id, index) => [id, index]));
					const centers = new Map(
						[...memberships].map(([id, members]) => [
							id,
							members.length
								? members.reduce((sum, id) => sum + (ranks.get(id) ?? 0), 0) /
									members.length
								: 0,
						]),
					);
					const rank = (id: string) => {
						const nets = componentNets.get(id) ?? [];
						const weights = nets.map(
							(net) => 1 / Math.max(1, (memberships.get(net)?.length ?? 1) - 1),
						);
						return nets.length
							? nets.reduce(
									(sum, net, index) =>
										sum + (centers.get(net) ?? 0) * weights[index],
									0,
								) / weights.reduce((sum, weight) => sum + weight, 0)
							: (ranks.get(id) ?? 0);
					};
					const barycenters = new Map(order.map((id) => [id, rank(id)]));
					order = [...order].sort(
						(a, b) =>
							(barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0) ||
							(ranks.get(a) ?? 0) - (ranks.get(b) ?? 0),
					);
					addOrder(order);
				}
			}
			let best = [
				...graph.components.map((node) => ({
					id: node.id,
					kind: "component" as const,
					...snapCircuitPoint({ x: node.x, y: node.y }, step),
				})),
				...graph.nets.map((node) => ({
					id: node.id,
					kind: "net" as const,
					...snapCircuitPoint({ x: node.x, y: node.y }, step),
				})),
			];
			let bestScore = score(
				buildCircuitGraph({
					...file,
					graph: { ...file.graph, positions: best },
				}),
			);
			const gap =
				Math.max(160, ...graph.nets.map((node) => netNodeWidth(node.label))) +
				100;
			const pitch = Math.ceil((componentWidth + gap) / step) * step;
			for (const order of orders)
				for (
					let columns = 1;
					columns <= Math.min(4, Math.max(1, order.length));
					columns++
				) {
					const extra = (columns - (order.length % columns)) % columns;
					const gaps =
						order.length <= 10 && extra
							? Array.from({ length: order.length + 1 }, (_, index) => index)
							: [order.length];
					for (const gapStart of gaps) {
						const slots = [
							...order.slice(0, gapStart),
							...Array.from({ length: extra }, () => null),
							...order.slice(gapStart),
						];
						const positions: GraphLayout["positions"] = [];
						let rowY = Math.ceil(60 / step) * step;
						for (let start = 0; start < slots.length; start += columns) {
							const row = slots.slice(start, start + columns);
							row.forEach((id, index) => {
								if (!id) return;
								positions.push({
									id,
									kind: "component",
									...snapCircuitPoint({ x: 60 + index * pitch, y: rowY }, step),
								});
							});
							rowY +=
								Math.ceil(
									(Math.max(
										...row.map((id) =>
											id ? (components.get(id)?.height ?? 84) : 0,
										),
									) +
										120) /
										step,
								) * step;
						}
						const placed = new Map(
							positions.map((position) => [position.id, position]),
						);
						const terminals = new Map<string, Point>();
						for (const id of order) {
							const node = components.get(id),
								position = placed.get(id);
							if (!node || !position) continue;
							node.component.pins.forEach((pin, index) => {
								terminals.set(pin.id, {
									x: position.x + componentWidth / 2,
									y: position.y + (node.collapsed ? 32 : 84 + index * 30),
								});
							});
						}
						const occupied: Box[] = [];
						let empty = 0;
						for (const node of graph.nets) {
							const members = node.net.pinIds
								.map((id) => terminals.get(id))
								.filter((point): point is Point => Boolean(point));
							const center = members.length
								? {
										x:
											members.reduce((sum, p) => sum + p.x, 0) / members.length,
										y:
											members.reduce((sum, p) => sum + p.y, 0) / members.length,
									}
								: {
										x:
											60 + (empty % columns) * pitch + componentWidth + gap / 2,
										y: rowY + 80 + Math.floor(empty++ / columns) * 100,
									};
							const gutters = Array.from(
								{ length: columns + 1 },
								(_, index) => 60 + index * pitch - gap / 2,
							);
							const x = snapCircuitPoint(
								{
									x: gutters.reduce((closest, x) =>
										Math.abs(x - center.x) < Math.abs(closest - center.x)
											? x
											: closest,
									),
									y: 0,
								},
								step,
							).x;
							const spacing = Math.ceil(80 / step) * step;
							let y = snapCircuitPoint(center, step).y;
							let box = netClearance(x, y, node.label);
							for (
								let attempt = 0;
								occupied.some((other) => intersects(box, other));
								attempt++
							) {
								y =
									snapCircuitPoint(center, step).y +
									Math.ceil((attempt + 1) / 2) *
										spacing *
										(attempt % 2 === 0 ? 1 : -1);
								box = netClearance(x, y, node.label);
							}
							occupied.push(box);
							positions.push({ id: node.id, kind: "net", x, y });
						}
						const quality = score(
							buildCircuitGraph({
								...file,
								graph: { ...file.graph, positions },
							}),
						);
						if (better(quality, bestScore)) {
							best = positions;
							bestScore = quality;
						}
					}
				}
			function refine(positions: GraphLayout["positions"]) {
				const quality = score(
					buildCircuitGraph({ ...file, graph: { ...file.graph, positions } }),
				);
				if (better(quality, bestScore)) {
					best = positions;
					bestScore = quality;
					return true;
				}
				return false;
			}
			if (
				graph.components.length <= 10 &&
				graph.nets.length <= 12 &&
				(bestScore.crossings > 0 || bestScore.obstructions > 0)
			) {
				for (
					let sweep = 0;
					sweep < 2 && (bestScore.crossings > 0 || bestScore.obstructions > 0);
					sweep++
				) {
					let improved = false;
					for (
						let first = 0;
						first < initial.length &&
						(bestScore.crossings > 0 || bestScore.obstructions > 0);
						first++
					)
						for (let second = first + 1; second < initial.length; second++) {
							const a = best.find((position) => position.id === initial[first]);
							const b = best.find(
								(position) => position.id === initial[second],
							);
							if (!a || !b) continue;
							improved =
								refine(
									best.map((position) =>
										position.id === a.id
											? { ...position, x: b.x, y: b.y }
											: position.id === b.id
												? { ...position, x: a.x, y: a.y }
												: position,
									),
								) || improved;
						}
					const compact = buildCircuitGraph({
						...file,
						graph: { ...file.graph, positions: best },
					});
					const xs = [
						...new Set(
							compact.components.flatMap((node) => [
								node.x - gap / 2,
								node.x + componentWidth + gap / 2,
							]),
						),
					];
					for (const net of compact.nets) {
						if (!bestScore.crossings && !bestScore.obstructions) break;
						const ys = [
							...new Set([
								net.y,
								...net.net.pinIds.flatMap((id) => {
									const pin = compact.pinNodes.get(id);
									return pin ? [pin.y] : [];
								}),
								Math.min(...compact.components.map((node) => node.y)) - 80,
								Math.max(
									...compact.components.map((node) => node.y + node.height),
								) + 80,
							]),
						];
						for (const x of xs)
							for (const y of ys) {
								improved =
									refine(
										best.map((position) =>
											position.id === net.id
												? { ...position, ...snapCircuitPoint({ x, y }, step) }
												: position,
										),
									) || improved;
							}
					}
					if (!improved) break;
				}
			}
			return best;
		},
		{
			components: file.circuit.components.length,
			nets: file.circuit.nets.length,
		},
	);
}

export function createCircuitView(circuit: Circuit): CircuitFile {
	const file: CircuitFile = {
		circuit,
		graph: {
			format: "ecad-circuit-graph",
			version: 1,
			circuitId: circuit.id,
			positions: [],
		},
	};
	file.graph.positions = untangleCircuitGraph(file);
	return file;
}
