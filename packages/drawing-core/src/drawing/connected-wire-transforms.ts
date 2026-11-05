import { connectionTolerance } from "#/drawing/connection-geometry.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import {
	drawShape,
	localToWorld,
	snapPoint,
} from "#/drawing/shape-geometry.ts";
import { pinTerminals } from "#/drawing/terminals.ts";
import type { Point } from "#/drawing/types.ts";
import {
	addRouteWires,
	createRoutingIndex,
	type Heading,
	headingOf,
	type RoutingIndex,
	reverseHeading,
	segmentClear,
} from "#/drawing/wire-router.ts";
import {
	addShapeObstacles,
	emptyObstacles,
	isElectricalLabel,
	type NetLookup,
	type PinEnd,
	pathWires,
	pinEnds,
	routePath,
	routingPitch,
	wireEnds,
} from "#/drawing/wire-routing.ts";
import { unionFind } from "#/lib/union-find.ts";
import { measurePerformance } from "#/performance/runtime.ts";

function movementTerminals(shape: EditorShape): readonly Point[] {
	if (isElectricalLabel(shape)) return [{ x: shape.x, y: shape.y }];
	return pinTerminals(shape);
}

/** Pin ends aligned with `movementTerminals`; labels have no lead. */
function movementEnds(shape: EditorShape): (PinEnd | undefined)[] {
	if (isElectricalLabel(shape)) return [undefined];
	return pinEnds(shape);
}

export function moveShapes(
	shapes: EditorShape[],
	delta: Point,
	gridStep = 0,
	anchorShape = shapes[0],
	allShapes = shapes,
	nextShapeId = [...allShapes, ...shapes].reduce(
		(maximum, shape) => Math.max(maximum, shape.id),
		0,
	) + 1,
	allowLocked = false,
): EditorShape[] {
	if (!allowLocked && shapes.some((shape) => shape.locked)) return shapes;
	if (gridStep > 0 && anchorShape) {
		// Keep corners on the grid even when the center lies halfway between grid lines.
		const anchor =
			anchorShape.kind === "circle" ||
			anchorShape.kind === "symbol" ||
			anchorShape.kind === "pin" ||
			anchorShape.kind === "no-connect" ||
			anchorShape.kind === "text"
				? anchorShape
				: localToWorld(
						anchorShape,
						-anchorShape.width / 2,
						anchorShape.kind === "wire" || anchorShape.kind === "line"
							? 0
							: -anchorShape.height / 2,
					);
		const target = snapPoint(
			{ x: anchor.x + delta.x, y: anchor.y + delta.y },
			gridStep,
		);
		delta = { x: target.x - anchor.x, y: target.y - anchor.y };
	}
	const moved = shapes.map((shape) => ({
		...shape,
		x: shape.x + delta.x,
		y: shape.y + delta.y,
	}));
	if (delta.x === 0 && delta.y === 0) return moved;
	return connectTransformedTerminals(shapes, moved, allShapes, nextShapeId, {
		pitch: gridStep,
		delta,
	});
}

interface GraphNode {
	readonly id: number;
	readonly point: Point;
	readonly pieces: number[];
	readonly pins: PinEnd[];
	readonly labels: EditorShape[];
}

/** A wire between two consecutive connection points along it. */
interface Piece {
	readonly id: number;
	readonly wire: EditorShape;
	readonly start: number;
	readonly end: number;
	/** Whether each end is one of the wire's own endpoints, rather than a split point. */
	readonly startIsEnd: boolean;
	readonly endIsEnd: boolean;
	/** The wire's own coordinates at each end, so untouched ends keep exact values. */
	readonly from: Point;
	readonly to: Point;
}

interface WireGraph {
	readonly nodes: GraphNode[];
	readonly pieces: Piece[];
	/** Pieces of each wire in order from its start. */
	readonly byWire: Map<number, number[]>;
	readonly nodeAt: (point: Point) => GraphNode | undefined;
	readonly nets: NetLookup;
}

const samePoint = (a: Point, b: Point) =>
	Math.abs(a.x - b.x) <= connectionTolerance &&
	Math.abs(a.y - b.y) <= connectionTolerance;

const keyOf = (value: number) => Math.round(value * 1000);

function buildGraph(allShapes: readonly EditorShape[]): WireGraph {
	const nodes: GraphNode[] = [];
	const cells = new Map<string, GraphNode[]>();
	const find = (point: Point) => {
		const x = keyOf(point.x);
		const y = keyOf(point.y);
		for (let dx = -1; dx <= 1; dx++)
			for (let dy = -1; dy <= 1; dy++)
				for (const node of cells.get(`${x + dx},${y + dy}`) ?? [])
					if (samePoint(node.point, point)) return node;
		return undefined;
	};
	const nodeFor = (point: Point) => {
		const existing = find(point);
		if (existing) return existing;
		const node: GraphNode = {
			id: nodes.length,
			point,
			pieces: [],
			pins: [],
			labels: [],
		};
		nodes.push(node);
		const key = `${keyOf(point.x)},${keyOf(point.y)}`;
		const cell = cells.get(key);
		if (cell) cell.push(node);
		else cells.set(key, [node]);
		return node;
	};
	for (const shape of allShapes) {
		for (const end of pinEnds(shape)) nodeFor(end.point).pins.push(end);
		if (isElectricalLabel(shape))
			nodeFor({ x: shape.x, y: shape.y }).labels.push(shape);
	}
	const wires = allShapes.flatMap((shape) => {
		if (shape.kind !== "wire" || shape.width <= connectionTolerance) return [];
		const [start, end] = wireEnds(shape);
		nodeFor(start);
		nodeFor(end);
		return [{ shape, start, end }];
	});
	// Points sorted per row and column, to find the ones on each wire's interior.
	const rows = new Map<number, GraphNode[]>();
	const columns = new Map<number, GraphNode[]>();
	for (const node of nodes) {
		for (const [index, value] of [
			[rows, node.point.y],
			[columns, node.point.x],
		] as const) {
			const key = keyOf(value);
			const entries = index.get(key);
			if (entries) entries.push(node);
			else index.set(key, [node]);
		}
	}
	const pieces: Piece[] = [];
	const byWire = new Map<number, number[]>();
	for (const { shape, start, end } of wires) {
		const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
		const along = vertical ? "y" : "x";
		const across = vertical ? "x" : "y";
		const index = vertical ? columns : rows;
		const lo = Math.min(start[along], end[along]) + connectionTolerance;
		const hi = Math.max(start[along], end[along]) - connectionTolerance;
		const interior: GraphNode[] = [];
		const key = keyOf(start[across]);
		for (let offset = -1; offset <= 1; offset++)
			for (const node of index.get(key + offset) ?? [])
				if (
					Math.abs(node.point[across] - start[across]) <= connectionTolerance &&
					node.point[along] > lo &&
					node.point[along] < hi
				)
					interior.push(node);
		const direction = end[along] >= start[along] ? 1 : -1;
		interior.sort((a, b) => (a.point[along] - b.point[along]) * direction);
		const chain = [
			nodeFor(start),
			...interior.filter(
				(node, position) => position === 0 || interior[position - 1] !== node,
			),
			nodeFor(end),
		];
		const ids: number[] = [];
		const ownPoint = (node: GraphNode, position: number) =>
			position === 0
				? start
				: position === chain.length - 1
					? end
					: vertical
						? { x: start.x, y: node.point.y }
						: { x: node.point.x, y: start.y };
		for (let position = 1; position < chain.length; position++) {
			const piece: Piece = {
				from: ownPoint(chain[position - 1], position - 1),
				to: ownPoint(chain[position], position),
				id: pieces.length,
				wire: shape,
				start: chain[position - 1].id,
				end: chain[position].id,
				startIsEnd: position === 1,
				endIsEnd: position === chain.length - 1,
			};
			pieces.push(piece);
			ids.push(piece.id);
			nodes[piece.start].pieces.push(piece.id);
			nodes[piece.end].pieces.push(piece.id);
		}
		byWire.set(shape.id, ids);
	}
	return {
		nodes,
		pieces,
		byWire,
		nodeAt: find,
		nets: graphNets(nodes, pieces, byWire),
	};
}

/**
 * Nets from wire geometry alone. Unlike `electricalNets`, nets that share only
 * a label name stay apart, so routes keep clear of them too. That is cheaper and
 * never joins nets.
 */
function graphNets(
	nodes: readonly GraphNode[],
	pieces: readonly Piece[],
	byWire: ReadonlyMap<number, number[]>,
): NetLookup {
	const sets = unionFind(nodes.length);
	for (const piece of pieces) sets.union(piece.end, piece.start);
	const pins = new Map<string, number>();
	const labels = new Map<number, number>();
	for (const node of nodes) {
		for (const pin of node.pins)
			pins.set(`${pin.shape.id}:${pin.pinId}`, sets.find(node.id));
		for (const label of node.labels) labels.set(label.id, sets.find(node.id));
	}
	// Items without a node or wire piece are isolated, clear of node indexes.
	const isolated = 1 << 28;
	return {
		wire: (id) => {
			const first = byWire.get(id)?.[0];
			return first === undefined
				? isolated + id * 2
				: sets.find(pieces[first].start);
		},
		pin: (shapeId, pinId) =>
			pins.get(`${shapeId}:${pinId}`) ?? isolated + shapeId * 2 + 1,
		label: (id) => labels.get(id) ?? isolated + id * 2,
	};
}

interface MovedNode {
	/** Index into the selected shapes and their terminals, or the selected wire. */
	readonly terminal?: { shape: number; index: number };
	readonly wire?: { shape: number; t: number };
	readonly net: number;
	readonly label?: boolean;
}

type TraceKind = "rip" | "move" | "internal";

interface Trace {
	readonly kind: TraceKind;
	readonly moved: number;
	/** The other end node. For a ripped trace this is the fixed node it reroutes from. */
	readonly other: number;
	readonly pieces: number[];
	readonly net: number;
}

interface SelectionContext {
	readonly moved: Map<number, MovedNode>;
	readonly traces: Trace[];
	/** Moved nodes that keep the wire or pin they touch and get a new connection to it. */
	readonly stubs: number[];
	readonly index: RoutingIndex;
	/** The last result, reused while a drag stays on the same snapped delta. */
	last?: { key: string; result: EditorShape[] };
}

interface GraphCache {
	graph: WireGraph;
	selections: Map<string, SelectionContext>;
}

const graphs = new WeakMap<readonly EditorShape[], GraphCache>();

function selectionContext(
	shapes: readonly EditorShape[],
	allShapes: readonly EditorShape[],
): { graph: WireGraph; context: SelectionContext } {
	let cache = graphs.get(allShapes);
	if (!cache) {
		cache = { graph: buildGraph(allShapes), selections: new Map() };
		graphs.set(allShapes, cache);
	}
	const { graph } = cache;
	const key = shapes.map((shape) => shape.id).join(",");
	let context = cache.selections.get(key);
	if (!context) {
		context = createSelectionContext(graph, shapes, allShapes);
		// Drags reuse one selection, so a small cache is enough.
		if (cache.selections.size > 4) cache.selections.clear();
		cache.selections.set(key, context);
	}
	return { graph, context };
}

function createSelectionContext(
	graph: WireGraph,
	shapes: readonly EditorShape[],
	allShapes: readonly EditorShape[],
): SelectionContext {
	const { nodes, pieces, nets } = graph;
	const selectedIds = new Set(shapes.map((shape) => shape.id));
	const moved = new Map<number, MovedNode>();
	for (const [shapeIndex, shape] of shapes.entries()) {
		if (shape.kind === "wire") {
			const [start, end] = wireEnds(shape);
			const length = Math.hypot(end.x - start.x, end.y - start.y);
			for (const pieceId of graph.byWire.get(shape.id) ?? [])
				for (const nodeId of [pieces[pieceId].start, pieces[pieceId].end]) {
					if (moved.has(nodeId)) continue;
					const { point } = nodes[nodeId];
					moved.set(nodeId, {
						wire: {
							shape: shapeIndex,
							t: length
								? Math.hypot(point.x - start.x, point.y - start.y) / length
								: 0,
						},
						net: nets.wire(shape.id),
					});
				}
			continue;
		}
		const ends = movementEnds(shape);
		for (const [index, point] of movementTerminals(shape).entries()) {
			const node = graph.nodeAt(point);
			if (!node) continue;
			const end = ends[index];
			// A pin's entry, with its lead direction, wins over a label on it.
			if (!end && moved.has(node.id)) continue;
			moved.set(node.id, {
				terminal: { shape: shapeIndex, index },
				net: end ? nets.pin(shape.id, end.pinId) : nets.label(shape.id),
				label: !end,
			});
		}
	}
	const selectedPiece = (piece: Piece) => selectedIds.has(piece.wire.id);
	const fixed = (node: GraphNode) =>
		node.pieces.length !== 2 ||
		node.pins.some(({ shape }) => !selectedIds.has(shape.id)) ||
		node.labels.some((shape) => !selectedIds.has(shape.id));
	const visited = new Set<number>();
	const traces: Trace[] = [];
	const stubs: number[] = [];

	for (const nodeId of moved.keys()) {
		const node = nodes[nodeId];
		// A stationary label stays and gets a new branch, while the pin's wires
		// still follow the pin.
		let stub = node.labels.some((shape) => !selectedIds.has(shape.id));
		// A label only drags the wire it ends. Elsewhere it gets a new branch, as
		// does a terminal on a stationary pin: that pin's wires are its own.
		if (
			node.pins.some(({ shape }) => !selectedIds.has(shape.id)) ||
			(moved.get(nodeId)?.label && node.pieces.length > 1)
		) {
			stubs.push(nodeId);
			continue;
		}
		for (const first of node.pieces) {
			const firstPiece = pieces[first];
			if (selectedPiece(firstPiece) || visited.has(first)) continue;
			// A wire running through the terminal stays; the terminal gets a new branch to it.
			const throughWire =
				(firstPiece.start === nodeId && !firstPiece.startIsEnd) ||
				(firstPiece.end === nodeId && !firstPiece.endIsEnd);
			if (throughWire || firstPiece.wire.locked) {
				stub = true;
				continue;
			}
			const trace: number[] = [];
			let current = nodeId;
			let pieceId = first;
			let kind: TraceKind = "rip";
			for (;;) {
				const piece = pieces[pieceId];
				if (piece.wire.locked || selectedPiece(piece)) break;
				trace.push(pieceId);
				visited.add(pieceId);
				current = piece.start === current ? piece.end : piece.start;
				const next = nodes[current];
				if (moved.has(current)) {
					kind = "internal";
					break;
				}
				if (fixed(next)) {
					if (
						next.pieces.length === 1 &&
						!next.pins.length &&
						!next.labels.length
					)
						kind = "move";
					break;
				}
				const following = next.pieces.find((id) => id !== pieceId);
				if (following === undefined || visited.has(following)) break;
				pieceId = following;
			}
			traces.push({
				kind,
				moved: nodeId,
				other: current,
				pieces: trace,
				net: nets.wire(firstPiece.wire.id),
			});
		}
		if (stub) stubs.push(nodeId);
	}
	// Everything that stays put is a static obstacle. Pieces of traces move or reroute.
	const tracePieces = new Set(traces.flatMap((trace) => trace.pieces));
	const obstacles = emptyObstacles();
	for (const shape of allShapes) {
		if (selectedIds.has(shape.id)) continue;
		if (shape.kind !== "wire") {
			addShapeObstacles(obstacles, shape, nets);
			continue;
		}
		for (const pieceId of graph.byWire.get(shape.id) ?? []) {
			if (tracePieces.has(pieceId)) continue;
			const piece = pieces[pieceId];
			obstacles.wires.push({
				start: piece.from,
				end: piece.to,
				net: nets.wire(shape.id),
			});
		}
	}
	return { moved, traces, stubs, index: createRoutingIndex(obstacles) };
}

type PieceState =
	| { kind: "rip"; at: Point }
	| { kind: "move"; from: Point; to: Point };

/**
 * Rubber-bands wires after selected shapes move or rotate. Each wire stretch
 * from a moved terminal back to its first fixed node is deleted and routed
 * again, so no stale segment remains. Stubs that end in the open move along.
 * Returns the transformed selection, changed wires, and new wire segments.
 * A deleted wire is returned with zero length; committing drops it.
 */
export function connectTransformedTerminals(
	shapes: EditorShape[],
	replacements: EditorShape[],
	allShapes: EditorShape[],
	nextShapeId: number,
	options: { pitch?: number; delta?: Point } = {},
): EditorShape[] {
	if (shapes.length === 0) return replacements;
	return measurePerformance(
		"editor.rubber-band",
		() => rubberBand(shapes, replacements, allShapes, nextShapeId, options),
		{ shapes: allShapes.length, selected: shapes.length },
	);
}

function rubberBand(
	shapes: EditorShape[],
	replacements: EditorShape[],
	allShapes: EditorShape[],
	nextShapeId: number,
	{ pitch = 0, delta }: { pitch?: number; delta?: Point },
): EditorShape[] {
	const { graph, context } = selectionContext(shapes, allShapes);
	if (!context.traces.length && !context.stubs.length) return replacements;
	const key =
		delta && `${delta.x},${delta.y},${pitch},${nextShapeId},${fullRouting}`;
	if (key && context.last?.key === key) return context.last.result;
	const result = rerouteSelection(
		graph,
		context,
		shapes,
		replacements,
		allShapes,
		nextShapeId,
		pitch,
		delta,
	);
	if (key) context.last = { key, result };
	return result;
}

function rerouteSelection(
	graph: WireGraph,
	context: SelectionContext,
	shapes: EditorShape[],
	replacements: EditorShape[],
	allShapes: EditorShape[],
	nextShapeId: number,
	pitch: number,
	delta: Point | undefined,
): EditorShape[] {
	const { nodes, pieces, nets } = graph;
	const transformedEnds = replacements.map((shape) => movementEnds(shape));
	const transformedTerminals = replacements.map((shape) =>
		movementTerminals(shape),
	);
	const target = (nodeId: number): { point: Point; pin?: PinEnd } => {
		const info = context.moved.get(nodeId);
		const pin = info?.terminal
			? transformedEnds[info.terminal.shape][info.terminal.index]
			: undefined;
		// A translation moves every node by exactly the delta, without rounding.
		if (info && delta)
			return { point: offset(nodes[nodeId].point, delta), pin };
		if (info?.terminal) {
			const { shape, index } = info.terminal;
			return {
				point: transformedTerminals[shape][index] ?? nodes[nodeId].point,
				pin: transformedEnds[shape][index],
			};
		}
		if (info?.wire) {
			const [start, end] = wireEnds(replacements[info.wire.shape]);
			return {
				point: {
					x: start.x + (end.x - start.x) * info.wire.t,
					y: start.y + (end.y - start.y) * info.wire.t,
				},
			};
		}
		return { point: nodes[nodeId].point };
	};
	const displacement = (nodeId: number) => {
		const { point } = target(nodeId);
		const original = nodes[nodeId].point;
		return { x: point.x - original.x, y: point.y - original.y };
	};
	const stationaryPin = (node: GraphNode) =>
		node.pins.find(
			({ shape }) => !shapes.some((selected) => selected.id === shape.id),
		);

	const originalEnds = shapes.map((shape) => movementEnds(shape));
	const outwardBefore = (nodeId: number) => {
		const terminal = context.moved.get(nodeId)?.terminal;
		return terminal
			? originalEnds[terminal.shape][terminal.index]?.outward
			: stationaryPin(nodes[nodeId])?.outward;
	};
	const outwardAfter = (nodeId: number) =>
		context.moved.has(nodeId)
			? target(nodeId).pin?.outward
			: stationaryPin(nodes[nodeId])?.outward;

	const dynamic = emptyObstacles();
	for (const shape of replacements) addShapeObstacles(dynamic, shape, nets);
	const dynamicIndex = createRoutingIndex(dynamic);
	const indexes: RoutingIndex[] = [context.index, dynamicIndex];
	const states = new Map<number, PieceState>();
	const zero = { x: 0, y: 0 };
	/** The trace's end at `nodeId`, then its far end, in old or new geometry. */
	const endAt = (
		pieceId: number,
		nodeId: number,
		geometry?: ReadonlyMap<number, readonly [Point, Point]>,
	) => {
		const piece = pieces[pieceId];
		const [from, to] = geometry?.get(pieceId) ?? [piece.from, piece.to];
		return piece.start === nodeId
			? ([from, to] as const)
			: ([to, from] as const);
	};
	const direction = ([at, far]: readonly [Point, Point]) =>
		samePoint(at, far)
			? undefined
			: headingOf(Math.atan2(far.y - at.y, far.x - at.x));
	// A pin left along its lead before the move must still be left that way,
	// and a moved end without a lead must not double back over its old wire.
	const keepsLead = (
		pieceId: number,
		nodeId: number,
		geometry: ReadonlyMap<number, readonly [Point, Point]>,
	) => {
		const original = direction(endAt(pieceId, nodeId));
		const now = direction(endAt(pieceId, nodeId, geometry));
		const before = outwardBefore(nodeId);
		if (before !== undefined && original === before) {
			const after = outwardAfter(nodeId);
			return after === undefined || now === after;
		}
		return (
			!context.moved.get(nodeId)?.terminal ||
			now === undefined ||
			original === undefined ||
			now === original
		);
	};
	/**
	 * Stretches a trace the way dragging a segment does: each node follows a
	 * moved node along the axes its segments share. Wiring between two parts
	 * moved together translates. Returns undefined when the stretch would move
	 * a fixed node, touch another net or pin, cross a body, or leave a pin
	 * sideways; the trace is routed again instead.
	 */
	const stretchTrace = (trace: Trace) => {
		const moved = displacement(trace.moved);
		const internal = trace.kind === "internal";
		if (internal && !samePoint(moved, displacement(trace.other))) return;
		const rigid =
			internal &&
			!!context.moved.get(trace.moved)?.terminal &&
			!!context.moved.get(trace.other)?.terminal;
		const shift = rigid
			? undefined
			: stretchNodes(
					graph,
					trace.pieces,
					internal ? [trace.moved, trace.other] : [trace.moved],
					displacement,
				);
		const shiftOf = (nodeId: number) =>
			shift ? (shift.get(nodeId) ?? zero) : moved;
		if (trace.kind === "rip" && !samePoint(shiftOf(trace.other), zero)) return;
		const geometry = new Map<number, readonly [Point, Point]>();
		for (const pieceId of trace.pieces) {
			const piece = pieces[pieceId];
			geometry.set(pieceId, [
				offset(piece.from, shiftOf(piece.start)),
				offset(piece.to, shiftOf(piece.end)),
			]);
		}
		const ends = [target(trace.moved).point, target(trace.other).point];
		const own = new Set([trace.net]);
		for (const [start, end] of geometry.values())
			if (!segmentClear(indexes, start, end, own, ends)) return;
		const first = trace.pieces[0];
		const last = trace.pieces[trace.pieces.length - 1];
		if (
			!keepsLead(first, trace.moved, geometry) ||
			!keepsLead(last, trace.other, geometry)
		)
			return;
		return geometry;
	};
	const reroute: Trace[] = [];
	for (const trace of context.traces) {
		const geometry = stretchTrace(trace);
		if (!geometry) {
			reroute.push(trace);
			continue;
		}
		for (const [pieceId, [from, to]] of geometry)
			states.set(pieceId, { kind: "move", from, to });
		addRouteWires(
			dynamicIndex,
			[...geometry.values()].map(([start, end]) => ({
				start,
				end,
				net: trace.net,
			})),
		);
	}
	let unsafe = false;
	// One budget per step keeps a drag over crowded parts responsive.
	const budget = {
		remaining: fullRouting ? Number.POSITIVE_INFINITY : 30_000,
	};

	interface Route {
		net: number;
		wires: number[];
		points: Point[];
		lineWidth?: number;
	}
	const routes: Route[] = [];
	const route = (
		net: number,
		from: { point: Point; heading?: Heading },
		to: { point: Point; pin?: PinEnd },
		memory: (readonly [Point, Point])[],
		wires: number[],
		lineWidth?: number,
	) => {
		if (samePoint(from.point, to.point)) return;
		const { points, clear } = routePath(indexes, {
			from: { point: from.point, heading: from.heading, strict: true },
			to: { point: to.point, arrive: reverseHeading(to.pin?.outward) },
			nets: new Set([net]),
			pitch: routingPitch(pitch),
			memory,
			budget,
		});
		if (!clear) unsafe = true;
		routes.push({ net, wires, points, lineWidth });
		addRouteWires(
			dynamicIndex,
			points.slice(1).map((end, index) => ({ start: points[index], end, net })),
		);
	};
	for (const trace of reroute) {
		const internal = trace.kind === "internal";
		const fixedNode = nodes[trace.other];
		const from = internal
			? (() => {
					const end = target(trace.other);
					return { point: end.point, heading: end.pin?.outward };
				})()
			: { point: fixedNode.point, heading: stationaryPin(fixedNode)?.outward };
		const memory = trace.pieces.map((pieceId) => {
			const piece = pieces[pieceId];
			return [piece.from, piece.to] as const;
		});
		for (const pieceId of trace.pieces)
			states.set(pieceId, { kind: "rip", at: fixedNode.point });
		const wires = [
			...new Set(trace.pieces.map((pieceId) => pieces[pieceId].wire.id)),
		];
		route(
			trace.net,
			from,
			target(trace.moved),
			memory,
			wires,
			pieces[trace.pieces[0]]?.wire.lineWidth,
		);
	}
	for (const nodeId of context.stubs) {
		const node = nodes[nodeId];
		route(
			context.moved.get(nodeId)?.net ?? Number.MAX_SAFE_INTEGER,
			{ point: node.point, heading: stationaryPin(node)?.outward },
			target(nodeId),
			[],
			[],
		);
	}

	// Rebuild every wire that lost or moved pieces.
	const changed = new Map<number, EditorShape>();
	const additions: EditorShape[] = [];
	const freed: number[] = [];
	for (const [wireId, pieceIds] of graph.byWire) {
		if (!pieceIds.some((pieceId) => states.has(pieceId))) continue;
		const wire = pieces[pieceIds[0]].wire;
		// Consecutive pieces that still meet end to end stay one wire.
		const groups: { last: number; from: Point; to: Point }[] = [];
		for (const pieceId of pieceIds) {
			const state = states.get(pieceId);
			if (state?.kind === "rip") continue;
			const [from, to] =
				state?.kind === "move"
					? [state.from, state.to]
					: [pieces[pieceId].from, pieces[pieceId].to];
			const last = groups.at(-1);
			if (last && last.last === pieceId - 1 && samePoint(last.to, from)) {
				last.last = pieceId;
				last.to = to;
			} else groups.push({ last: pieceId, from, to });
		}
		const segments = groups.map(({ from, to }) =>
			drawShape(0, "wire", from, to),
		);
		if (!segments.length) {
			const state = states.get(pieceIds[0]);
			const at = state?.kind === "rip" ? state.at : wireEnds(wire)[0];
			changed.set(wireId, {
				...wire,
				...drawShape(wireId, "wire", at, at),
				lineWidth: wire.lineWidth,
			});
			freed.push(wireId);
			continue;
		}
		for (const [index, segment] of segments.entries()) {
			const id = index === 0 ? wireId : nextShapeId++;
			const shape = { ...wire, ...segment, id, lineWidth: wire.lineWidth };
			if (index === 0) changed.set(wireId, shape);
			else additions.push(shape);
		}
	}
	// Reuse the IDs of deleted wires for their own trace's new segments.
	for (const { wires, points, lineWidth } of routes) {
		const reusable = wires.filter((id) => freed.includes(id));
		for (const segment of pathWires(0, points, lineWidth)) {
			const reused = reusable.shift();
			if (reused !== undefined) {
				freed.splice(freed.indexOf(reused), 1);
				const original = changed.get(reused);
				changed.set(reused, {
					...original,
					...segment,
					id: reused,
				} as EditorShape);
			} else additions.push({ ...segment, id: nextShapeId++ });
		}
	}
	const order = new Map(allShapes.map((shape, index) => [shape.id, index]));
	const result = [
		...replacements,
		...[...changed.values()].sort(
			(a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
		),
		...additions,
	];
	if (unsafe) unsafeMoves.add(result);
	return result;
}

const unsafeMoves = new WeakSet<readonly EditorShape[]>();

export const UNSAFE_MOVE_MESSAGE =
	"No wire route here avoids other nets, so the move was not applied.";

let fullRouting = false;

/**
 * Runs moves without the per-step search budget that keeps drag previews
 * responsive. Committing paths use it, so a move is refused only when no safe
 * route exists, not when a preview ran out of time.
 */
export function withFullRouting<T>(work: () => T): T {
	const previous = fullRouting;
	fullRouting = true;
	try {
		return work();
	} finally {
		fullRouting = previous;
	}
}

/**
 * Whether a move result routes a wire through another net because no safe
 * route was found. Previews may show it; committing it would join the nets.
 */
export const isUnsafeMove = (result: readonly EditorShape[]) =>
	unsafeMoves.has(result);

/**
 * Moves stretched nodes along shared axes: a horizontal segment's ends share
 * vertical movement, a vertical segment's ends share horizontal movement.
 */
function stretchNodes(
	graph: WireGraph,
	pieceIds: readonly number[],
	seeds: Iterable<number>,
	displacement: (nodeId: number) => Point,
): Map<number, Point> {
	const { nodes, pieces } = graph;
	const links = [new Map<number, number[]>(), new Map<number, number[]>()];
	const link = (axis: number, a: number, b: number) => {
		for (const [from, to] of [
			[a, b],
			[b, a],
		]) {
			const list = links[axis].get(from);
			if (list) list.push(to);
			else links[axis].set(from, [to]);
		}
	};
	for (const pieceId of pieceIds) {
		const { start, end } = pieces[pieceId];
		const a = nodes[start].point;
		const b = nodes[end].point;
		// Axis 0 shares x movement (vertical segment), axis 1 shares y movement.
		link(Math.abs(b.x - a.x) < Math.abs(b.y - a.y) ? 0 : 1, start, end);
	}
	const shift = new Map<number, Point>();
	const seedIds = [...seeds];
	for (const axis of [0, 1]) {
		const reached = new Map<number, number>();
		const pending: number[] = [];
		for (const seed of seedIds) {
			const value = axis === 0 ? displacement(seed).x : displacement(seed).y;
			reached.set(seed, value);
			pending.push(seed);
		}
		for (let index = 0; index < pending.length; index++) {
			const node = pending[index];
			for (const next of links[axis].get(node) ?? []) {
				if (reached.has(next)) continue;
				reached.set(next, reached.get(node) ?? 0);
				pending.push(next);
			}
		}
		for (const [node, value] of reached) {
			const current = shift.get(node) ?? { x: 0, y: 0 };
			shift.set(
				node,
				axis === 0 ? { ...current, x: value } : { ...current, y: value },
			);
		}
	}
	return shift;
}

const offset = (point: Point, by: Point) => ({
	x: point.x + by.x,
	y: point.y + by.y,
});
