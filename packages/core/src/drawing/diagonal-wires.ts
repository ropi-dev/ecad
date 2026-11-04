import { unionFind } from "@ecad/drawing-core/lib/union-find.ts";
import type { ShapeInput } from "#/commands/drawing-commands.ts";
import { electricalNets } from "#/drawing/named-nets.ts";
import {
	connectionTolerance,
	DEFAULT_LINE_WIDTH,
	type EditorShape,
	pinTerminals,
	shapeBounds,
} from "#/drawing/shapes.ts";
import type { Bounds } from "#/drawing/types.ts";

/**
 * Routing for diagonal drawing wires. Drawing wires must be horizontal or
 * vertical, so KiCad import and drawings saved before that rule redraw each
 * diagonal through corners, only where no net changes, now or after the wire
 * normalization that every later command runs.
 */

type XY = [number, number];
export type Segment = [XY, XY];

function distance(point: XY, [a, b]: Segment) {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const length = dx * dx + dy * dy;
	const t = length
		? Math.max(
				0,
				Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length),
			)
		: 0;
	return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}
const near = (a: XY, b: XY) => distance(a, [b, b]) <= connectionTolerance;

function wireSegments(shape: EditorShape): Segment[] {
	if (shape.kind !== "wire") return [];
	const dx = (Math.cos(shape.rotation) * shape.width) / 2;
	const dy = (Math.sin(shape.rotation) * shape.width) / 2;
	return [
		[
			[shape.x - dx, shape.y - dy],
			[shape.x + dx, shape.y + dy],
		],
	];
}

const isVertical = ([a, b]: Segment) =>
	Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1]);
/**
 * The coordinate across a wire, such as y for a horizontal wire, at its
 * center. Normalization rebuilds merged and cut wires on this line.
 */
const across = ([a, b]: Segment) => {
	const axis = isVertical([a, b]) ? 0 : 1;
	return (a[axis] + b[axis]) / 2;
};
/** Floating-point noise; anything larger is a real offset. */
const EXACT = 1e-12;
/** A wire that normalization can rebuild without moving it. */
const exactlyStraight = ([a, b]: Segment) => {
	const axis = isVertical([a, b]) ? 0 : 1;
	return Math.abs(a[axis] - b[axis]) <= EXACT;
};

/** The extent of a wire along its own direction. */
const extent = (segment: Segment): [number, number] => {
	const along = isVertical(segment) ? 1 : 0;
	return [
		Math.min(segment[0][along], segment[1][along]),
		Math.max(segment[0][along], segment[1][along]),
	];
};

/**
 * Wires whose merge adds no geometry: exactly in line, overlapping or touching.
 * Normalization would fill any gap between them, which can reach a label or
 * pin that neither wire touched.
 */
function mergeKeepsShape(first: Segment, second: Segment) {
	const [a, b] = extent(first);
	const [c, d] = extent(second);
	return (
		exactlyStraight(first) &&
		exactlyStraight(second) &&
		Math.abs(across(first) - across(second)) <= EXACT &&
		a <= d + EXACT &&
		c <= b + EXACT
	);
}

/** Wires that wire normalization may merge: parallel, in line and overlapping. */
function mayMerge(first: Segment, second: Segment) {
	if (isVertical(first) !== isVertical(second)) return false;
	const along = isVertical(first) ? 1 : 0;
	const [a, b] = first;
	const [c, d] = second;
	return (
		Math.abs(across(first) - across(second)) <= connectionTolerance &&
		Math.min(a[along], b[along]) <=
			Math.max(c[along], d[along]) + connectionTolerance &&
		Math.min(c[along], d[along]) <=
			Math.max(a[along], b[along]) + connectionTolerance
	);
}

const overlaps = (first: Bounds, second: Bounds) =>
	first.minX <= second.maxX &&
	first.maxX >= second.minX &&
	first.minY <= second.maxY &&
	first.maxY >= second.minY;
const segmentBounds = (segments: readonly Segment[], margin = 0): Bounds => {
	const points = segments.flat();
	return {
		minX: Math.min(...points.map((point) => point[0])) - margin,
		minY: Math.min(...points.map((point) => point[1])) - margin,
		maxX: Math.max(...points.map((point) => point[0])) + margin,
		maxY: Math.max(...points.map((point) => point[1])) + margin,
	};
};

/**
 * Normalization merges a cluster of parallel wires into one wire on the line of
 * one of them, chosen by the command that runs it, and rebuilds a wire it cuts
 * on that wire's center line. A cluster whose wires are slightly tilted or not
 * exactly in line can move, even a cluster of one, and one with gaps along its
 * length gets them filled. These are the areas such clusters can change.
 */
function driftAreas(wires: readonly Segment[]): Bounds[] {
	const sets = unionFind(wires.length);
	for (let first = 0; first < wires.length; first++)
		for (let second = first + 1; second < wires.length; second++)
			if (mayMerge(wires[first], wires[second])) sets.union(first, second);
	const clusters = new Map<number, Segment[]>();
	for (const [index, wire] of wires.entries())
		clusters.set(sets.find(index), [
			...(clusters.get(sets.find(index)) ?? []),
			wire,
		]);
	return [...clusters.values()]
		.filter((cluster) => {
			const lines = cluster.map(across);
			if (
				!cluster.every(exactlyStraight) ||
				Math.max(...lines) - Math.min(...lines) > EXACT
			)
				return true;
			const extents = cluster.map(extent).sort((a, b) => a[0] - b[0]);
			let reach = extents[0][1];
			for (const [start, end] of extents) {
				if (start > reach + EXACT) return true;
				reach = Math.max(reach, end);
			}
			return false;
		})
		.map((cluster) => segmentBounds(cluster, connectionTolerance));
}

const reaches = new WeakMap<EditorShape, Bounds>();
/**
 * The bounds of everything a shape connects through. A child override can
 * move a pin outside its symbol's own bounds, and a label connects at its
 * anchor.
 */
function reach(shape: EditorShape): Bounds {
	const cached = reaches.get(shape);
	if (cached) return cached;
	const bounds = [
		...(shape.kind === "text" ? [{ x: shape.x, y: shape.y }] : []),
		...pinTerminals(shape),
	].reduce(
		(bounds, point) => ({
			minX: Math.min(bounds.minX, point.x),
			minY: Math.min(bounds.minY, point.y),
			maxX: Math.max(bounds.maxX, point.x),
			maxY: Math.max(bounds.maxY, point.y),
		}),
		shapeBounds(shape),
	);
	reaches.set(shape, bounds);
	return bounds;
}

/** The net of each source wire, pin and label, counting joins by label name. */
function sourceNets(shapes: readonly EditorShape[]) {
	const nets = new Map<string, string>();
	for (const [index, net] of electricalNets(shapes).entries()) {
		for (const id of net.wires) nets.set(`wire ${id}`, `net ${index}`);
		for (const pin of net.pins)
			nets.set(`pin ${pin.shapeId} ${pin.pinId}`, `net ${index}`);
		for (const label of net.labels) nets.set(`label ${label}`, `net ${index}`);
	}
	return nets;
}

/**
 * What `wires` would connect to: source nets, and other diagonals as
 * `diagonal <index>`. Only shapes near the wires can touch them.
 */
function joined(
	drawing: readonly EditorShape[],
	groups: ReadonlyMap<string, string>,
	wires: readonly EditorShape[],
) {
	const box = segmentBounds(wires.flatMap(wireSegments), 1);
	const local = drawing.filter(
		(shape) =>
			(shape.kind === "wire" ||
				shape.kind === "pin" ||
				shape.kind === "symbol" ||
				(shape.kind === "text" && shape.electrical)) &&
			overlaps(reach(shape), box),
	);
	const ids = new Set(wires.map((wire) => wire.id));
	const net = electricalNets([...local, ...wires]).find((net) =>
		net.wires.some((id) => ids.has(id)),
	);
	return new Set(
		[
			...(net?.wires.filter((id) => !ids.has(id)).map((id) => `wire ${id}`) ??
				[]),
			...(net?.pins.map((pin) => `pin ${pin.shapeId} ${pin.pinId}`) ?? []),
			...(net?.labels.map((label) => `label ${label}`) ?? []),
		].map((item) => groups.get(item)),
	);
}

const sameSet = <T>(first: ReadonlySet<T>, second: ReadonlySet<T>) =>
	first.size === second.size && [...first].every((item) => second.has(item));

/**
 * ecad wires are horizontal or vertical, so each diagonal wire turns a
 * corner. A diagonal first splits wherever something connects along it in
 * the source, and each piece takes the first corner where:
 * - the new wires join exactly the nets the diagonal joined, counting nets
 *   joined by label name anywhere in the drawing; and
 * - wire normalization, which every later command runs, cannot move or
 *   delete the new wires or move or extend another wire onto them. Each new
 *   wire is at least 0.001 mm long, can merge only with wires exactly in line
 *   that it overlaps or touches, and stays clear of clusters that
 *   normalization could shift or join across a gap.
 * Returns each diagonal's wires, or undefined where a piece has no such
 * corner and the diagonal stays a graphic line.
 */
export function routeDiagonalWires(
	diagonals: readonly Segment[],
	shapes: readonly EditorShape[],
): (EditorShape[] | undefined)[] {
	if (!diagonals.length) return [];
	let nextId = shapes.reduce(
		(maximum, shape) => Math.max(maximum, shape.id),
		0,
	);
	// Exact lengths: stretching a very short wire could reach a neighbor.
	const wire = (a: XY, b: XY): EditorShape => ({
		id: ++nextId,
		kind: "wire",
		x: (a[0] + b[0]) / 2,
		y: (a[1] + b[1]) / 2,
		width: Math.hypot(b[0] - a[0], b[1] - a[1]),
		height: DEFAULT_LINE_WIDTH,
		rotation: Math.atan2(b[1] - a[1], b[0] - a[0]),
		lineWidth: DEFAULT_LINE_WIDTH,
	});
	const sourceWires = shapes.flatMap(wireSegments);
	const drift = driftAreas(sourceWires);
	// Routes join exactly what their diagonals joined, so source nets stay valid.
	const groups = new Map(sourceNets(shapes));
	const diagonal = (index: number, shape: EditorShape) => {
		groups.set(`wire ${shape.id}`, `diagonal ${index}`);
		return shape;
	};
	const sourcePoints = [
		...shapes.flatMap((shape): XY[] =>
			shape.kind === "text" && shape.electrical
				? [[shape.x, shape.y]]
				: pinTerminals(shape).map((pin): XY => [pin.x, pin.y]),
		),
		...sourceWires.flat(),
		...diagonals.flat(),
	];
	const chains = diagonals.map(([start, end]) => {
		const along = (point: XY) =>
			(point[0] - start[0]) * (end[0] - start[0]) +
			(point[1] - start[1]) * (end[1] - start[1]);
		const chain = [start];
		for (const point of sourcePoints
			.filter(
				(point) =>
					distance(point, [start, end]) <= connectionTolerance &&
					!near(point, end),
			)
			.sort((first, second) => along(first) - along(second)))
			if (!near(point, chain[chain.length - 1])) chain.push(point);
		return [...chain, end];
	});
	const current = [...shapes];
	const pending = diagonals.map(([a, b], index) => diagonal(index, wire(a, b)));
	return chains.map((chain, index) => {
		// Every other diagonal, routed or not, as it stands now.
		const drawing = [...current, ...pending.slice(index + 1)];
		const pieces: EditorShape[] = [];
		for (let stop = 1; stop < chain.length; stop++) {
			const [from, to] = [chain[stop - 1], chain[stop]];
			const existing = [...current, ...pieces].flatMap(wireSegments);
			const stable = (segment: Segment) =>
				distance(segment[0], [segment[1], segment[1]]) >= 0.001 &&
				existing.every(
					(other) =>
						!mayMerge(segment, other) || mergeKeepsShape(segment, other),
				) &&
				drift.every((area) => !overlaps(segmentBounds([segment]), area));
			const expected = joined(drawing, groups, [wire(from, to)]);
			const route = (
				[
					[to[0], from[1]],
					[from[0], to[1]],
				] as XY[]
			)
				.map((corner) => [wire(from, corner), wire(corner, to)])
				.find(
					(route) =>
						route.flatMap(wireSegments).every(stable) &&
						sameSet(joined(drawing, groups, route), expected),
				);
			if (!route) break;
			pieces.push(...route);
		}
		if (pieces.length < 2 * (chain.length - 1)) return undefined;
		for (const piece of pieces) diagonal(index, piece);
		current.push(...pieces);
		return pieces;
	});
}

/** A drawing wire saved before wires had to be horizontal or vertical. */
export const isLegacyDiagonalWire = (shape: EditorShape) =>
	shape.kind === "wire" && Math.abs(Math.sin(2 * shape.rotation)) > 1e-9;

/**
 * Redraws a drawing's legacy diagonal wires, for one command: each becomes
 * horizontal and vertical wires where no net changes, or else a graphic line.
 * `shapes` must have every symbol resolved, so the router sees every pin.
 */
export function rerouteLegacyWires(shapes: readonly EditorShape[]) {
	const legacy = shapes.filter(isLegacyDiagonalWire);
	if (!legacy.length) return;
	const routes = routeDiagonalWires(
		legacy.flatMap(wireSegments),
		shapes.filter((shape) => !isLegacyDiagonalWire(shape)),
	);
	const replacements: EditorShape[] = [];
	const additions: ShapeInput[] = [];
	for (const [index, wire] of legacy.entries()) {
		const route = routes[index];
		if (!route) {
			replacements.push({ ...wire, kind: "line" });
			continue;
		}
		const [first, ...rest] = route.map(({ id: _id, ...piece }) => ({
			...piece,
			lineWidth: wire.lineWidth,
			...(wire.locked === undefined ? {} : { locked: wire.locked }),
		}));
		replacements.push({ ...first, id: wire.id } as EditorShape);
		additions.push(...rest);
	}
	const lines = routes.filter((route) => !route).length;
	return {
		replacements,
		additions,
		notice: [
			lines < legacy.length &&
				`Redrew ${legacy.length - lines} diagonal ${legacy.length - lines === 1 ? "wire" : "wires"} from an older version as horizontal and vertical wires.`,
			lines &&
				(lines === 1
					? "1 diagonal wire is now a graphic line, because redrawing it would change connections. Draw it again as wires to reconnect."
					: `${lines} diagonal wires are now graphic lines, because redrawing them would change connections. Draw them again as wires to reconnect.`),
		]
			.filter(Boolean)
			.join(" "),
	};
}
