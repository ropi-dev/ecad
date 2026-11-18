import {
	boardHoles,
	type CopperItem,
	type CopperLayer,
	copperItems,
	itemDistance,
	type ZoneReach,
	zoneClearance,
	zonePriority,
} from "@ecad/drawing-core/board/connectivity.ts";
import {
	boardOutlineSegments,
	outlineClosed,
} from "@ecad/drawing-core/board/drc.ts";
import {
	boundsOverlap,
	type Hull,
	hullBounds,
	hullDistance,
	hullPolygon,
	pointHullDistance,
	zoneCorners,
} from "@ecad/drawing-core/board/geometry.ts";
import type { BoardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import type { BoardRules } from "@ecad/drawing-core/board/rules.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Bounds, Point } from "@ecad/drawing-core/drawing/types.ts";
import { unionFind } from "@ecad/drawing-core/lib/union-find.ts";
import ClipperLib from "clipper-lib";
import {
	combinePolygons,
	containsPoint,
	type MultiPolygon,
	triangulate,
} from "#/engine/geometry.ts";

export interface ZoneFill {
	zone: CopperItem;
	layer: CopperLayer;
	net?: string;
	/** Copper islands that touch an item on the zone's net. */
	polygons: MultiPolygon;
}

export interface BoardFill {
	shapeId: number;
	layer: CopperLayer;
	net?: string;
	polygons: MultiPolygon;
	triangles: Float32Array;
}

export const boardFills = (fills: readonly ZoneFill[]): BoardFill[] =>
	fills.map((fill) => ({
		shapeId: fill.zone.shapeId,
		layer: fill.layer,
		...(fill.net ? { net: fill.net } : {}),
		polygons: fill.polygons,
		triangles: triangulate(fill.polygons),
	}));

type Ring = [number, number][];
const ring = (points: readonly Point[]): Ring =>
	points.map((point) => [point.x, point.y]);
const scale = 1e6;
const offsetTolerance = 0.002;

function clipperPath(points: Ring): ClipperLib.Path {
	const path = points.map(([x, y]) => ({
		X: Math.round(x * scale),
		Y: Math.round(y * scale),
	}));
	return ClipperLib.Clipper.Orientation(path) ? path : path.reverse();
}

function fromClipper(tree: ClipperLib.PolyTree): MultiPolygon {
	const back = (path: ClipperLib.Path): Ring =>
		path.map(({ X, Y }) => [X / scale, Y / scale]);
	const polygons: MultiPolygon = [];
	const visit = (outer: ClipperLib.PolyNode) => {
		const holes = outer.Childs();
		polygons.push([
			back(outer.Contour()),
			...holes.map((hole) => back(hole.Contour())),
		]);
		for (const hole of holes) for (const island of hole.Childs()) visit(island);
	};
	for (const outer of tree.Childs()) visit(outer);
	return polygons;
}

function fillPaths(polygons: MultiPolygon): ClipperLib.Paths {
	return polygons.flatMap((polygon) =>
		polygon.map((path, index) => {
			const converted = clipperPath(path);
			return index === 0 ? converted : converted.reverse();
		}),
	);
}

function grown(
	polygons: MultiPolygon,
	margin: number,
	near: Bounds,
): ClipperLib.Paths {
	const window = {
		minX: near.minX - margin,
		minY: near.minY - margin,
		maxX: near.maxX + margin,
		maxY: near.maxY + margin,
	};
	const kept = polygons.flatMap(([outer, ...holes]) =>
		boundsOverlap(boundsOfRing(outer), window)
			? [
					[
						outer,
						...holes.filter((hole) =>
							boundsOverlap(boundsOfRing(hole), window),
						),
					],
				]
			: [],
	);
	if (!kept.length) return [];
	const top = (path: ClipperLib.Path) =>
		path.reduce((highest, point) => Math.max(highest, point.Y), -Infinity);
	const offset = new ClipperLib.ClipperOffset(2, offsetTolerance * scale);
	offset.AddPaths(
		fillPaths(kept).sort((a, b) => top(a) - top(b)),
		ClipperLib.JoinType.jtRound,
		ClipperLib.EndType.etClosedPolygon,
	);
	const result: ClipperLib.Paths = [];
	offset.Execute(result, (margin + 3 * offsetTolerance) * scale);
	return result;
}

/** @return The area a zone outline encloses, by the even-odd rule, as hit testing and connectivity read it. */
function outlineRegion(points: Ring): MultiPolygon {
	const clipper = new ClipperLib.Clipper();
	clipper.AddPath(clipperPath(points), ClipperLib.PolyType.ptSubject, true);
	const tree = new ClipperLib.PolyTree();
	clipper.Execute(
		ClipperLib.ClipType.ctUnion,
		tree,
		ClipperLib.PolyFillType.pftEvenOdd,
		ClipperLib.PolyFillType.pftEvenOdd,
	);
	return fromClipper(tree);
}

/** @return `region` less the union of `obstacles` and `keepOut`, computed in integer nanometres. */
function subtractObstacles(
	region: MultiPolygon,
	obstacles: readonly Ring[],
	keepOut: ClipperLib.Paths = [],
): MultiPolygon {
	const clipper = new ClipperLib.Clipper();
	clipper.AddPaths(
		region.flatMap((polygon) => polygon.map(clipperPath)),
		ClipperLib.PolyType.ptSubject,
		true,
	);
	clipper.AddPaths(
		[...obstacles.map(clipperPath), ...keepOut],
		ClipperLib.PolyType.ptClip,
		true,
	);
	const tree = new ClipperLib.PolyTree();
	clipper.Execute(
		ClipperLib.ClipType.ctDifference,
		tree,
		ClipperLib.PolyFillType.pftEvenOdd,
		ClipperLib.PolyFillType.pftNonZero,
	);
	return fromClipper(tree);
}
const arc = Math.PI / 16;

/** Closed loops chained from outline segments whose ends meet. */
function outlineLoops(
	segments: readonly (readonly [Point, Point])[],
): Point[][] {
	const key = (point: Point) =>
		`${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`;
	const unused = new Set(segments.map((_, index) => index));
	const loops: Point[][] = [];
	while (unused.size) {
		const first = unused.values().next().value as number;
		unused.delete(first);
		const loop = [segments[first][0], segments[first][1]];
		let closed = false;
		for (let guard = 0; guard < segments.length; guard++) {
			const end = key(loop[loop.length - 1]);
			if (end === key(loop[0])) {
				closed = true;
				break;
			}
			let next = -1;
			let reversed = false;
			for (const index of unused) {
				if (key(segments[index][0]) === end) {
					next = index;
					break;
				}
				if (key(segments[index][1]) === end) {
					next = index;
					reversed = true;
					break;
				}
			}
			if (next < 0) break;
			unused.delete(next);
			loop.push(segments[next][reversed ? 0 : 1]);
		}
		if (closed && loop.length > 3) loops.push(loop.slice(0, -1));
	}
	return loops;
}

export function boardInterior(shapes: readonly EditorShape[]): MultiPolygon {
	const segments = boardOutlineSegments(shapes);
	if (!outlineClosed(segments)) return [];
	const loops = outlineLoops(segments);
	// Even-odd: an outline inside another one cuts a hole.
	let interior: MultiPolygon = [];
	for (const loop of loops) {
		const polygon: MultiPolygon = [[ring(loop)]];
		interior = interior.length
			? containsPoint(interior, loop[0])
				? combinePolygons(interior, polygon, true)
				: combinePolygons(interior, polygon)
			: combinePolygons(polygon);
	}
	return interior;
}

const fillCache = new WeakMap<
	readonly EditorShape[],
	{ netlist: BoardNetlist; rules: BoardRules; fills: ZoneFill[] }
>();

type EdgeGrid = Map<string, Hull[]>;

const gridSize = 1;
const reachLimit = 1;
const edgeCache = new WeakMap<MultiPolygon[number], EdgeGrid>();

function polygonEdges(polygon: MultiPolygon[number]): EdgeGrid {
	let grid = edgeCache.get(polygon);
	if (grid) return grid;
	const cells = new Map<string, Hull[]>();
	for (const path of polygon)
		path.forEach(([x, y], index) => {
			const [nx, ny] = path[(index + 1) % path.length];
			const hull: Hull = {
				points: [
					{ x, y },
					{ x: nx, y: ny },
				],
				radius: 0,
			};
			for (
				let cx = Math.floor(Math.min(x, nx) / gridSize);
				cx <= Math.floor(Math.max(x, nx) / gridSize);
				cx++
			)
				for (
					let cy = Math.floor(Math.min(y, ny) / gridSize);
					cy <= Math.floor(Math.max(y, ny) / gridSize);
					cy++
				) {
					const key = `${cx},${cy}`;
					const list = cells.get(key);
					if (list) list.push(hull);
					else cells.set(key, [hull]);
				}
		});
	grid = cells;
	edgeCache.set(polygon, grid);
	return grid;
}

const ringBounds = new WeakMap<Ring, Bounds>();

function boundsOfRing(path: Ring): Bounds {
	let bounds = ringBounds.get(path);
	if (!bounds) {
		bounds = {
			minX: Infinity,
			minY: Infinity,
			maxX: -Infinity,
			maxY: -Infinity,
		};
		for (const [x, y] of path) {
			bounds.minX = Math.min(bounds.minX, x);
			bounds.minY = Math.min(bounds.minY, y);
			bounds.maxX = Math.max(bounds.maxX, x);
			bounds.maxY = Math.max(bounds.maxY, y);
		}
		ringBounds.set(path, bounds);
	}
	return bounds;
}

function inRing(path: Ring, point: Point) {
	const bounds = boundsOfRing(path);
	return (
		point.x >= bounds.minX &&
		point.x <= bounds.maxX &&
		point.y >= bounds.minY &&
		point.y <= bounds.maxY &&
		containsPoint([[path]], point)
	);
}

const insideFill = (polygons: MultiPolygon, point: Point) =>
	polygons.some(
		([outer, ...holes]) =>
			inRing(outer, point) && !holes.some((hole) => inRing(hole, point)),
	);

/** @return The gap from `item` to the fill, at most `within`; below zero inside it. */
function fillDistance(
	polygons: MultiPolygon,
	item: CopperItem,
	within = reachLimit,
): number {
	if (
		item.hulls.some((hull) =>
			hull.points.some((point) => insideFill(polygons, point)),
		)
	)
		return -Infinity;
	let distance = within;
	const { minX, minY, maxX, maxY } = item.bounds;
	for (const polygon of polygons) {
		const cells = polygonEdges(polygon);
		for (
			let cx = Math.floor((minX - within) / gridSize);
			cx <= Math.floor((maxX + within) / gridSize);
			cx++
		)
			for (
				let cy = Math.floor((minY - within) / gridSize);
				cy <= Math.floor((maxY + within) / gridSize);
				cy++
			)
				for (const edge of cells.get(`${cx},${cy}`) ?? [])
					for (const hull of item.hulls)
						distance = Math.min(distance, hullDistance(edge, hull));
	}
	return distance;
}

const touchesFill = (polygons: MultiPolygon, item: CopperItem) =>
	fillDistance(polygons, item, 1e-3) <= 1e-6;

const islandTouches = new WeakMap<
	MultiPolygon[number],
	WeakMap<EditorShape, boolean>
>();

function touchesIsland(polygon: MultiPolygon[number], item: CopperItem) {
	let byShape = islandTouches.get(polygon);
	if (!byShape) {
		byShape = new WeakMap();
		islandTouches.set(polygon, byShape);
	}
	let touches = byShape.get(item.shape);
	if (touches === undefined) {
		touches = touchesFill([polygon], item);
		byShape.set(item.shape, touches);
	}
	return touches;
}

const arcError = 1e-5;

const circumscribed = (hull: Hull, margin: number) =>
	(hull.radius + margin) / Math.cos(arc / 2) - hull.radius;

function cutouts(rings: readonly Ring[], spokes: readonly Ring[]) {
	const clipper = new ClipperLib.Clipper();
	clipper.AddPaths(rings.map(clipperPath), ClipperLib.PolyType.ptSubject, true);
	clipper.AddPaths(spokes.map(clipperPath), ClipperLib.PolyType.ptClip, true);
	const result: ClipperLib.Paths = [];
	clipper.Execute(
		ClipperLib.ClipType.ctDifference,
		result,
		ClipperLib.PolyFillType.pftNonZero,
		ClipperLib.PolyFillType.pftNonZero,
	);
	return result;
}

function crossesEdge(cells: CellGrid<Hull>, hull: Hull, skip: readonly Hull[]) {
	const inside = (other: Hull, point: Point) =>
		pointHullDistance(other, point) <= 1e-9;
	const bounds = hullBounds(hull);
	let crossed = false;
	forCells(bounds, (key) => {
		crossed ||= (cells.get(key) ?? []).some(
			(edge) =>
				boundsOverlap(hullBounds(edge), bounds) &&
				hullDistance(edge, hull) <= 1e-9 &&
				!skip.some(
					(other) =>
						inside(other, edge.points[0]) && inside(other, edge.points[1]),
				),
		);
	});
	return crossed;
}

interface Relief {
	pad: CopperItem;
	gap: number;
	group: number;
}

function padSpokes(
	relief: Relief,
	allowed: (point: Point) => boolean,
	edges: CellGrid<Hull>,
	joined: readonly Relief[],
	nearby: (bounds: Bounds) => Iterable<Relief>,
	width: number,
	clearance: number,
): Ring[] {
	const { pad, gap } = relief;
	const center = pad.points[0];
	const copper = joined.flatMap((other) => other.pad.hulls);
	const extent = (angle: number) => {
		const d = { x: Math.cos(angle), y: Math.sin(angle) };
		let reach = 0;
		let across = 0;
		for (const hull of pad.hulls)
			for (const point of hull.points) {
				const x = point.x - center.x;
				const y = point.y - center.y;
				reach = Math.max(reach, x * d.x + y * d.y + hull.radius);
				across = Math.max(across, Math.abs(y * d.x - x * d.y) + hull.radius);
			}
		return { d, reach, across };
	};
	const narrowest = Math.min(
		extent(pad.shape.rotation).across,
		extent(pad.shape.rotation + Math.PI / 2).across,
	);
	const spoke = (angle: number): Ring | undefined => {
		const { d, reach, across } = extent(angle);
		const half = Math.min(width / 2, across, narrowest);
		const at = (along: number, side: number) => ({
			x: center.x + d.x * along - d.y * side,
			y: center.y + d.y * along + d.x * side,
		});
		const end = reach + gap + half;
		const corners = [at(0, -half), at(end, -half), at(end, half), at(0, half)];
		const reaches = (point: Point) =>
			allowed(point) &&
			![
				...joined,
				...nearby({
					minX: point.x,
					minY: point.y,
					maxX: point.x,
					maxY: point.y,
				}),
			].some(
				(other) =>
					other !== relief &&
					other.pad.hulls.some(
						(hull) => pointHullDistance(hull, point) < other.gap,
					),
			);
		const insidePad = (point: Point) =>
			pad.hulls.some((hull) => pointHullDistance(hull, point) <= 0);
		const exit = (side: number) => {
			if (!insidePad(at(0, side))) return 0;
			let inside = 0;
			let outside = reach;
			while (outside - inside > 1e-4) {
				const middle = (inside + outside) / 2;
				if (insidePad(at(middle, side))) inside = middle;
				else outside = middle;
			}
			return inside;
		};
		const start = Math.min(exit(-half), exit(half));
		const outer = [
			at(start, -half),
			at(end, -half),
			at(end, half),
			at(start, half),
		];
		if (
			![half / 2, half / 4].some((offset) =>
				reaches(at(reach + gap + offset, 0)),
			) ||
			crossesEdge(edges, { points: outer, radius: 0 }, copper)
		)
			return undefined;
		const body: Hull = { points: outer, radius: 0 };
		const bounds = hullBounds(body);
		const tooClose = [...nearby(bounds)].some((other) => {
			if (
				other.group === relief.group ||
				!boundsOverlap(other.pad.bounds, bounds, clearance)
			)
				return false;
			const room = Math.min(clearance, itemDistance(pad, other.pad)) - 1e-9;
			return other.pad.hulls.some(
				(hull) => hullDistance(body, hull) < Math.min(room, other.gap),
			);
		});
		return tooClose ? undefined : ring(corners);
	};
	const round = pad.hulls.every((hull) => hull.points.length === 1);
	const first = pad.shape.rotation + (round ? Math.PI / 4 : 0);
	const set = (base: number) =>
		[0, 1, 2, 3].flatMap((quarter) => {
			const found = spoke(base + (quarter * Math.PI) / 2);
			return found ? [found] : [];
		});
	const straight = set(first);
	if (straight.length >= 2) return straight;
	const turned = set(first + Math.PI / 4);
	return turned.length >= 2 ? turned : [...straight, ...turned];
}

type CellGrid<T> = Map<number, T[]>;

function forCells(bounds: Bounds, visit: (key: number) => void) {
	for (
		let cx = Math.floor(bounds.minX / gridSize);
		cx <= bounds.maxX / gridSize;
		cx++
	)
		for (
			let cy = Math.floor(bounds.minY / gridSize);
			cy <= bounds.maxY / gridSize;
			cy++
		)
			visit(cellKey(cx, cy));
}

const cellKey = (cx: number, cy: number) => cx * 65536 + cy;

function addToCells<T>(
	grid: CellGrid<T> | undefined,
	near: ReadonlySet<number> | undefined,
	bounds: Bounds,
	value: T,
) {
	let added = false;
	forCells(bounds, (key) => {
		if (near && !near.has(key)) return;
		added = true;
		if (!grid) return;
		const list = grid.get(key);
		if (list) list.push(value);
		else grid.set(key, [value]);
	});
	return added;
}

function thermalCutouts(
	region: MultiPolygon,
	obstacles: readonly Ring[],
	earlier: ClipperLib.Paths,
	pads: readonly CopperItem[],
	inside: Bounds,
	gap: number,
	width: number,
	clearance: number,
): ClipperLib.Paths {
	const spread = (bounds: Bounds, margin: number): Bounds => ({
		minX: bounds.minX - margin,
		minY: bounds.minY - margin,
		maxX: bounds.maxX + margin,
		maxY: bounds.maxY + margin,
	});
	const padCells: CellGrid<number> = new Map();
	const ringGap = pads.map((pad) =>
		Math.max(...pad.hulls.map((hull) => circumscribed(hull, gap))),
	);
	pads.forEach((pad, index) => {
		addToCells(padCells, undefined, spread(pad.bounds, ringGap[index]), index);
	});
	const padsNear = (bounds: Bounds) => {
		const found = new Set<number>();
		forCells(bounds, (key) => {
			for (const index of padCells.get(key) ?? []) found.add(index);
		});
		return found;
	};
	const touching = unionFind(pads.length);
	pads.forEach((pad, index) => {
		for (const other of padsNear(pad.bounds))
			if (
				other > index &&
				boundsOverlap(pad.bounds, pads[other].bounds) &&
				itemDistance(pad, pads[other]) <= 1e-9
			)
				touching.union(index, other);
	});
	const reliefs: Relief[] = pads.map((pad, index) => ({
		pad,
		gap: ringGap[index],
		group: touching.find(index),
	}));
	const nearby = (bounds: Bounds) =>
		[...padsNear(bounds)].map((index) => reliefs[index]);
	const near = new Set<number>();
	for (const relief of reliefs) {
		const { minX, minY, maxX, maxY } = relief.pad.bounds;
		const margin =
			relief.gap + width + Math.hypot(maxX - minX, maxY - minY) / 2;
		forCells(spread(relief.pad.bounds, margin), (key) => near.add(key));
	}
	const edges: CellGrid<Hull> = new Map();
	const blocking: CellGrid<Ring> = new Map();
	const index = (path: Ring, grid: CellGrid<Ring> | undefined) => {
		if (!addToCells(grid, near, boundsOfRing(path), path)) return;
		for (let at = 0; at < path.length; at++) {
			const [x, y] = path[at];
			const [nx, ny] = path[(at + 1) % path.length];
			const edge: Hull = {
				points: [
					{ x, y },
					{ x: nx, y: ny },
				],
				radius: 0,
			};
			addToCells(edges, near, hullBounds(edge), edge);
		}
	};
	for (const obstacle of obstacles) index(obstacle, blocking);
	const earlierRings: CellGrid<{ path: Ring; sign: number }> = new Map();
	for (const path of earlier) {
		const back = path.map(({ X, Y }): [number, number] => [
			X / scale,
			Y / scale,
		]);
		index(back, undefined);
		addToCells(earlierRings, near, boundsOfRing(back), {
			path: back,
			sign: ClipperLib.Clipper.Orientation(path) ? 1 : -1,
		});
	}
	const allowed = (point: Point) => {
		if (!insideFill(region, point)) return false;
		const key = cellKey(
			Math.floor(point.x / gridSize),
			Math.floor(point.y / gridSize),
		);
		if (blocking.get(key)?.some((obstacle) => inRing(obstacle, point)))
			return false;
		let winding = 0;
		for (const { path, sign } of earlierRings.get(key) ?? [])
			if (inRing(path, point)) winding += sign;
		return winding <= 0;
	};
	const groups = new Map<number, Relief[]>();
	for (const relief of reliefs) {
		const group = groups.get(relief.group);
		if (group) group.push(relief);
		else groups.set(relief.group, [relief]);
	}
	const spokeCells: CellGrid<Ring> = new Map();
	for (const group of groups.values())
		for (const relief of group)
			if (boundsOverlap(relief.pad.bounds, inside))
				for (const spoke of padSpokes(
					relief,
					allowed,
					edges,
					group,
					nearby,
					width,
					clearance,
				))
					addToCells(spokeCells, undefined, boundsOfRing(spoke), spoke);
	return [...groups.values()].flatMap((group) => {
		const rings = group.flatMap((relief) =>
			relief.pad.hulls.map((hull) =>
				ring(hullPolygon(hull, circumscribed(hull, gap), arc)),
			),
		);
		const reach = rings.map(boundsOfRing).reduce((all, bounds) => ({
			minX: Math.min(all.minX, bounds.minX),
			minY: Math.min(all.minY, bounds.minY),
			maxX: Math.max(all.maxX, bounds.maxX),
			maxY: Math.max(all.maxY, bounds.maxY),
		}));
		const spokes = new Set<Ring>();
		forCells(reach, (key) => {
			for (const spoke of spokeCells.get(key) ?? [])
				if (boundsOverlap(boundsOfRing(spoke), reach)) spokes.add(spoke);
		});
		return spokes.size ? cutouts(rings, [...spokes]) : rings.map(clipperPath);
	});
}

/**
 * Fills each zone, highest priority first and in list order among equals: its
 * polygon or rectangle inside the board outline, or all of it until the
 * outline closes, less the edge clearance, the copper of other nets, unplated
 * holes and the fills of earlier zones on other nets, each grown by the
 * clearance, and less a thermal relief gap around each pad on its net, crossed
 * by spokes. Islands that reach nothing on the zone's
 * net, directly or through a touching island of another zone on that net, are
 * removed.
 */
export function fillZones(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	rules: BoardRules,
): ZoneFill[] {
	const cached = fillCache.get(shapes);
	if (cached?.netlist === netlist && cached.rules === rules)
		return cached.fills;
	const items = copperItems(shapes, netlist);
	const zones = items
		.filter((item) => item.kind === "zone")
		.sort((a, b) => zonePriority(b) - zonePriority(a));
	const regions: (ZoneFill & { members: CopperItem[] })[] = [];
	if (zones.length) {
		const interior = boardInterior(shapes);
		const edges = boardOutlineSegments(shapes).map((segment) => {
			const hull = { points: segment, radius: 0 };
			return ring(
				hullPolygon(hull, circumscribed(hull, rules.edgeClearance), arc),
			);
		});
		for (const zone of zones) {
			const layer = zone.layers[0];
			const clearance = Math.max(zoneClearance(zone), rules.clearance);
			let region = outlineRegion(ring(zoneCorners(zone.shape)));
			if (interior.length)
				region = combinePolygons(
					region,
					combinePolygons(region, interior, true),
					true,
				);
			const obstacles: Ring[] = [...edges];
			const others = items.filter(
				(item) =>
					item !== zone &&
					item.layers.includes(layer) &&
					item.kind !== "zone" &&
					boundsOverlap(item.bounds, zone.bounds, clearance) &&
					!(zone.net !== undefined && item.net === zone.net),
			);
			const holes = boardHoles(shapes).filter((hole) =>
				boundsOverlap(hole.bounds, zone.bounds, clearance),
			);
			for (const item of [...others, ...holes])
				for (const hull of item.hulls)
					obstacles.push(
						ring(hullPolygon(hull, circumscribed(hull, clearance), arc)),
					);
			const earlier = regions
				.filter(
					(fill) =>
						fill.layer === layer &&
						(zone.net === undefined || fill.net !== zone.net),
				)
				.flatMap((fill) =>
					grown(
						fill.polygons,
						Math.max(clearance, zoneClearance(fill.zone)),
						zone.bounds,
					),
				);
			const settings =
				zone.shape.kind === "rectangle" ? zone.shape.zone : undefined;
			const thermalGap = settings?.thermalGap ?? rules.thermalGap;
			const members = items.filter(
				(item) =>
					item !== zone &&
					item.kind !== "zone" &&
					zone.net !== undefined &&
					item.net === zone.net &&
					item.layers.includes(layer) &&
					boundsOverlap(
						item.bounds,
						zone.bounds,
						item.kind === "pad" ? thermalGap : 0,
					),
			);
			const pads =
				settings?.padConnection === "solid"
					? []
					: members.filter((item) => item.kind === "pad");
			if (region.length)
				region = subtractObstacles(
					region,
					obstacles,
					pads.length
						? [
								...earlier,
								...thermalCutouts(
									region,
									obstacles,
									earlier,
									pads,
									zone.bounds,
									thermalGap,
									settings?.thermalSpokeWidth ?? rules.thermalSpokeWidth,
									clearance,
								),
							]
						: earlier,
				);
			regions.push({
				zone,
				layer,
				...(zone.net ? { net: zone.net } : {}),
				polygons: region,
				members,
			});
		}
	}
	const kept = regions.map(({ polygons, members }) =>
		polygons.map((polygon) =>
			members.some(
				(item) =>
					boundsOverlap(item.bounds, boundsOfRing(polygon[0]), 1e-6) &&
					touchesFill([polygon], item),
			),
		),
	);
	for (let changed = true; changed; ) {
		changed = false;
		regions.forEach((fill, index) => {
			if (fill.net === undefined) return;
			fill.polygons.forEach((polygon, island) => {
				if (kept[index][island]) return;
				const reaches = regions.some(
					(other, otherIndex) =>
						otherIndex !== index &&
						other.net === fill.net &&
						other.layer === fill.layer &&
						other.polygons.some(
							(candidate, candidateIsland) =>
								kept[otherIndex][candidateIsland] &&
								polygonGap([polygon], [candidate]) <= 1e-6,
						),
				);
				if (reaches) {
					kept[index][island] = true;
					changed = true;
				}
			});
		});
	}
	const fills: ZoneFill[] = regions.map(
		({ members: _members, polygons, ...fill }, index) => ({
			...fill,
			polygons: polygons.filter((_, island) => kept[index][island]),
		}),
	);
	fillCache.set(shapes, { netlist, rules, fills });
	return fills;
}

function polygonGap(
	a: MultiPolygon,
	b: MultiPolygon,
	within = reachLimit,
): number {
	const first = (polygons: MultiPolygon) =>
		polygons.map(([[[x, y]]]) => ({ x, y }));
	if (
		first(a).some((point) => containsPoint(b, point)) ||
		first(b).some((point) => containsPoint(a, point))
	)
		return 0;
	let gap = within;
	for (const left of a)
		for (const edge of new Set([...polygonEdges(left).values()].flat())) {
			const [p, q] = edge.points;
			for (const right of b) {
				const cells = polygonEdges(right);
				for (
					let cx = Math.floor((Math.min(p.x, q.x) - gap) / gridSize);
					cx <= Math.floor((Math.max(p.x, q.x) + gap) / gridSize);
					cx++
				)
					for (
						let cy = Math.floor((Math.min(p.y, q.y) - gap) / gridSize);
						cy <= Math.floor((Math.max(p.y, q.y) + gap) / gridSize);
						cy++
					)
						for (const other of cells.get(`${cx},${cy}`) ?? [])
							gap = Math.min(gap, hullDistance(edge, other));
			}
		}
	return gap;
}

export function fillReach(fills: readonly ZoneFill[]): ZoneReach {
	const byZone = new Map(fills.map((fill) => [fill.zone.shapeId, fill]));
	return {
		gap: (a, b, within) => {
			const first = a.kind === "zone" ? byZone.get(a.shapeId) : undefined;
			const second = b.kind === "zone" ? byZone.get(b.shapeId) : undefined;
			if (first && second)
				return polygonGap(first.polygons, second.polygons, within);
			if (first) return fillDistance(first.polygons, b, within) + arcError;
			if (second) return fillDistance(second.polygons, a, within) + arcError;
			return itemDistance(a, b);
		},
		joined: (a, b) => {
			const first = byZone.get(a.shapeId);
			const second = byZone.get(b.shapeId);
			if (!first || !second) return [];
			const pairs: [number, number][] = [];
			first.polygons.forEach((left, i) => {
				second.polygons.forEach((right, j) => {
					if (polygonGap([left], [right]) <= 1e-6) pairs.push([i, j]);
				});
			});
			return pairs;
		},
		islands: (zone) => byZone.get(zone.shapeId)?.polygons.length ?? 1,
		touched: (zone, item) => {
			const fill = byZone.get(zone.shapeId);
			if (!fill) return itemDistance(zone, item) <= 1e-6 ? [0] : [];
			return fill.polygons.flatMap((polygon, index) =>
				touchesIsland(polygon, item) ? [index] : [],
			);
		},
	};
}

export function layerFill(
	fills: readonly Pick<ZoneFill, "layer" | "polygons">[],
	layer: CopperLayer,
): MultiPolygon {
	const paths = fills
		.filter((fill) => fill.layer === layer)
		.flatMap((fill) => fillPaths(fill.polygons));
	if (!paths.length) return [];
	const clipper = new ClipperLib.Clipper();
	clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
	const tree = new ClipperLib.PolyTree();
	clipper.Execute(
		ClipperLib.ClipType.ctUnion,
		tree,
		ClipperLib.PolyFillType.pftNonZero,
		ClipperLib.PolyFillType.pftNonZero,
	);
	return fromClipper(tree);
}
