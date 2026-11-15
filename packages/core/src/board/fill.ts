import {
	type CopperItem,
	type CopperLayer,
	copperItems,
	itemDistance,
	type ZoneReach,
	zoneClearance,
} from "@ecad/drawing-core/board/connectivity.ts";
import {
	boardOutlineSegments,
	outlineClosed,
} from "@ecad/drawing-core/board/drc.ts";
import {
	boundsOverlap,
	type Hull,
	hullDistance,
	hullPolygon,
	rectangleCorners,
} from "@ecad/drawing-core/board/geometry.ts";
import type { BoardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import type { BoardRules } from "@ecad/drawing-core/board/rules.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
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

function grown(polygons: MultiPolygon, margin: number): ClipperLib.Paths {
	if (!polygons.length) return [];
	const offset = new ClipperLib.ClipperOffset(2, offsetTolerance * scale);
	offset.AddPaths(
		fillPaths(polygons),
		ClipperLib.JoinType.jtRound,
		ClipperLib.EndType.etClosedPolygon,
	);
	const result: ClipperLib.Paths = [];
	offset.Execute(result, (margin + 3 * offsetTolerance) * scale);
	return result;
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

function boardInterior(shapes: readonly EditorShape[]): MultiPolygon {
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

/** @return The gap from `item` to the fill, at most `within`; below zero inside it. */
function fillDistance(
	polygons: MultiPolygon,
	item: CopperItem,
	within = reachLimit,
): number {
	if (
		item.hulls.some((hull) =>
			hull.points.some((point) => containsPoint(polygons, point)),
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
	fillDistance(polygons, item) <= 1e-6;

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

/**
 * Fills each zone: its rectangle inside the board outline, less the edge
 * clearance, the copper of other nets and the fills of earlier zones on other
 * nets, each grown by the clearance. Islands that reach nothing on the zone's
 * net, directly or through a touching island of another zone on that net,
 * are removed.
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
	const zones = items.filter((item) => item.kind === "zone");
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
			let region: MultiPolygon = combinePolygons([
				[ring(rectangleCorners(zone.shape))],
			]);
			region = interior.length
				? combinePolygons(region, combinePolygons(region, interior, true), true)
				: [];
			const obstacles: Ring[] = [...edges];
			const others = items.filter(
				(item) =>
					item !== zone &&
					item.layers.includes(layer) &&
					item.kind !== "zone" &&
					boundsOverlap(item.bounds, zone.bounds, clearance) &&
					!(zone.net !== undefined && item.net === zone.net),
			);
			for (const item of others)
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
					grown(fill.polygons, Math.max(clearance, zoneClearance(fill.zone))),
				);
			if (region.length) region = subtractObstacles(region, obstacles, earlier);
			const members = items.filter(
				(item) =>
					item !== zone &&
					item.kind !== "zone" &&
					zone.net !== undefined &&
					item.net === zone.net &&
					item.layers.includes(layer) &&
					boundsOverlap(item.bounds, zone.bounds),
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
			members.some((item) => touchesFill([polygon], item)),
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
