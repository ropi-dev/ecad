import { boardPads } from "#/board/footprints.ts";
import {
	type Hull,
	hullDistance,
	lineEnds,
	pointHullDistance,
	shapeHulls,
	trackSegment,
} from "#/board/geometry.ts";
import {
	copperClear,
	type RouteBudget,
	routeTrack,
	type TrackRoute,
	type TrackRouting,
	trackClear,
} from "#/board/track-router.ts";
import type { EditorShape, LineShape } from "#/drawing/schema.ts";
import { snapPoint } from "#/drawing/shape-geometry.ts";
import type { Point } from "#/drawing/types.ts";
import { markUnsafeMove } from "#/drawing/unsafe-moves.ts";
import {
	type CopperLayer,
	type FootprintLayer,
	isCopperLayer,
} from "#/footprint/layers.ts";
import { isVia, shapeLayers } from "#/footprint/shapes.ts";
import { measurePerformance } from "#/performance/runtime.ts";

type Track = LineShape & { layer: CopperLayer };

export const isBoardTrack = (shape: EditorShape): shape is Track =>
	shape.kind === "line" && isCopperLayer(shape.layer as FootprintLayer);

const join = 1e-4;

export const isCollapsedTrack = (shape: EditorShape) =>
	isBoardTrack(shape) && shape.width <= join;

const near = (a: Point, b: Point) =>
	Math.abs(a.x - b.x) <= join && Math.abs(a.y - b.y) <= join;

interface TrackEnd {
	readonly track: Track;
	readonly index: 0 | 1;
	readonly point: Point;
}

interface Anchor {
	readonly owner: number;
	readonly centre: Point;
	readonly layers: readonly string[];
	readonly hulls: readonly Hull[];
}

interface BoardIndex {
	readonly byId: Map<number, EditorShape>;
	readonly ends: Map<number, TrackEnd[]>;
	readonly anchors: readonly Anchor[];
	readonly bodies: Map<number, Track[]>;
}

const bodyKey = (x: number, y: number) =>
	(Math.floor(x) + 32_768) * 65_536 + Math.floor(y) + 32_768;

function forBodyBuckets(
	a: Point,
	b: Point,
	visit: (key: number) => void,
	pad = join,
) {
	for (
		let x = Math.floor(Math.min(a.x, b.x) - pad);
		x <= Math.floor(Math.max(a.x, b.x) + pad);
		x++
	)
		for (
			let y = Math.floor(Math.min(a.y, b.y) - pad);
			y <= Math.floor(Math.max(a.y, b.y) + pad);
			y++
		)
			visit(bodyKey(x, y));
}

function onBody(track: Track, point: Point, reach = join) {
	const [a, b] = lineEnds(track);
	const limit = Math.max(join, reach);
	if (segmentDistance(point, a, b) > limit) return false;
	return (
		Math.hypot(point.x - a.x, point.y - a.y) > limit &&
		Math.hypot(point.x - b.x, point.y - b.y) > limit
	);
}

function bodiesAt(index: BoardIndex, point: Point, reach = 0): Track[] {
	const x = Math.floor(point.x);
	const y = Math.floor(point.y);
	const found = new Set<Track>();
	for (let dx = -1; dx <= 1; dx++)
		for (let dy = -1; dy <= 1; dy++)
			for (const track of index.bodies.get(bodyKey(x + dx, y + dy)) ?? [])
				if (onBody(track, point, reach + track.lineWidth / 2)) found.add(track);
	return [...found];
}

function branchesOn(index: BoardIndex, track: Track): TrackEnd[] {
	const [a, b] = lineEnds(track);
	const seen = new Set<number>();
	const found: TrackEnd[] = [];
	forBodyBuckets(
		a,
		b,
		(key) => {
			for (const other of index.bodies.get(key) ?? []) {
				if (other.id === track.id || other.layer !== track.layer) continue;
				if (seen.has(other.id)) continue;
				seen.add(other.id);
				if (track.net && other.net && track.net !== other.net) continue;
				const reach = (track.lineWidth + other.lineWidth) / 2;
				for (const [end, point] of lineEnds(other).entries())
					if (onBody(track, point, reach))
						found.push({ track: other, index: end as 0 | 1, point });
			}
		},
		track.lineWidth / 2 + 1,
	);
	return found;
}

const indexes = new WeakMap<readonly EditorShape[], BoardIndex>();

function boardIndex(allShapes: readonly EditorShape[]): BoardIndex {
	const cached = indexes.get(allShapes);
	if (cached) return cached;
	const byId = new Map<number, EditorShape>();
	const ends = new Map<number, TrackEnd[]>();
	const anchors: Anchor[] = [];
	const bodies = new Map<number, Track[]>();
	for (const shape of allShapes) {
		byId.set(shape.id, shape);
		if (isVia(shape))
			anchors.push({
				owner: shape.id,
				centre: { x: shape.x, y: shape.y },
				layers: shapeLayers(shape),
				hulls: shapeHulls(shape),
			});
		if (!isBoardTrack(shape)) continue;
		const [a, b] = lineEnds(shape);
		forBodyBuckets(a, b, (key) => {
			const list = bodies.get(key);
			if (list) list.push(shape);
			else bodies.set(key, [shape]);
		});
		for (const [index, point] of lineEnds(shape).entries()) {
			const key = bodyKey(point.x, point.y);
			const end = { track: shape, index: index as 0 | 1, point };
			const list = ends.get(key);
			if (list) list.push(end);
			else ends.set(key, [end]);
		}
	}
	for (const pad of boardPads(allShapes))
		anchors.push({
			owner: pad.footprint.id,
			centre: { x: pad.shape.x, y: pad.shape.y },
			layers: shapeLayers(pad.shape),
			hulls: shapeHulls(pad.shape),
		});
	const index = { byId, ends, anchors, bodies };
	indexes.set(allShapes, index);
	return index;
}

function endsAt(
	index: BoardIndex,
	point: Point,
	reach: (end: TrackEnd) => number = () => join,
): TrackEnd[] {
	const found: TrackEnd[] = [];
	const x = Math.floor(point.x);
	const y = Math.floor(point.y);
	for (let dx = -1; dx <= 1; dx++)
		for (let dy = -1; dy <= 1; dy++)
			for (const end of index.ends.get(bodyKey(x + dx, y + dy)) ?? [])
				if (
					Math.hypot(end.point.x - point.x, end.point.y - point.y) <=
					Math.max(join, reach(end))
				)
					found.push(end);
	return found;
}

function segmentDistance(point: Point, a: Point, b: Point) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const length = dx * dx + dy * dy || 1;
	const t = Math.max(
		0,
		Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
	);
	return Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y);
}

const covers = (anchor: Anchor, point: Point, layer: string) =>
	anchor.layers.includes(layer) &&
	anchor.hulls.some((hull) => pointHullDistance(hull, point) <= join);

function withEnds(track: Track, from: Point, to: Point): Track {
	const { x, y, width, rotation } = trackSegment(
		track.id,
		from,
		to,
		track.layer,
		track.lineWidth,
		undefined,
	);
	return { ...track, x, y, width, rotation };
}

function slideAlong(
	joined: TrackEnd,
	target: Point,
	direction: Point,
): Point | undefined {
	const far = lineEnds(joined.track)[joined.index === 0 ? 1 : 0];
	const along = { x: joined.point.x - far.x, y: joined.point.y - far.y };
	const length = Math.hypot(along.x, along.y);
	const cross = along.x * direction.y - along.y * direction.x;
	if (length <= join || Math.abs(cross) <= 1e-6 * length) return undefined;
	const scale =
		((target.x - far.x) * direction.y - (target.y - far.y) * direction.x) /
		cross;
	if (scale * length <= join) return undefined;
	return { x: far.x + along.x * scale, y: far.y + along.y * scale };
}

type Ends = [Point | undefined, Point | undefined];

class Rework {
	result: EditorShape[] = [];
	readonly ignore: Set<number>;
	readonly rigid = new Set<number>();
	unsafe = false;
	private readonly selected: ReadonlySet<number>;
	private readonly added: EditorShape[] = [];
	private readonly owners = new Map<number, number>();
	private readonly reroutes = new Map<number, { track: Track; ends: Ends }>();
	private readonly stretches = new Map<number, { track: Track; ends: Ends }>();
	private readonly links: { from: Point; to: Point; track: Track }[] = [];
	private readonly budget: RouteBudget = { remaining: 30_000 };

	constructor(
		readonly index: BoardIndex,
		selected: Iterable<number>,
		private readonly nextShapeId: number,
		readonly routing: TrackRouting | undefined,
	) {
		this.selected = new Set(selected);
		this.ignore = new Set(this.selected);
	}

	anchorAt(point: Point, layer: string) {
		return this.index.anchors.find(
			(anchor) =>
				!this.ignore.has(anchor.owner) && covers(anchor, point, layer),
		);
	}

	holdAt(point: Point, layer: string, reach = 0) {
		const anchor = this.anchorAt(point, layer);
		if (anchor) return (to: Point) => covers(anchor, to, layer);
		const body = bodiesAt(this.index, point, reach).find(
			(track) => track.layer === layer && !this.ignore.has(track.id),
		);
		if (!body) return undefined;
		const [a, b] = lineEnds(body);
		return (to: Point) =>
			segmentDistance(to, a, b) <= reach + body.lineWidth / 2;
	}

	joinedAt(point: Point, layer?: string, net?: string, reach = 0) {
		const nearest = new Map<number, TrackEnd>();
		const distance = (end: TrackEnd) =>
			Math.hypot(end.point.x - point.x, end.point.y - point.y);
		for (const end of endsAt(
			this.index,
			point,
			(end) => reach + end.track.lineWidth / 2,
		)) {
			const { track } = end;
			if (this.ignore.has(track.id) || (layer && track.layer !== layer))
				continue;
			if (net !== undefined && track.net !== undefined && track.net !== net)
				continue;
			const known = nearest.get(track.id);
			if (!known || distance(end) < distance(known)) nearest.set(track.id, end);
		}
		return [...nearest.values()];
	}

	private record(
		into: Map<number, { track: Track; ends: Ends }>,
		{ track, index }: TrackEnd,
		to: Point,
	) {
		const entry = into.get(track.id) ?? {
			track,
			ends: [undefined, undefined] as Ends,
		};
		entry.ends[index] = to;
		into.set(track.id, entry);
	}

	stretch(joined: TrackEnd, to: Point) {
		this.record(this.stretches, joined, to);
	}

	follow(
		track: Track,
		from: Point,
		to: Point,
		joined = this.joinedAt(from, track.layer, track.net, track.lineWidth / 2),
	) {
		const hold = this.holdAt(from, track.layer, track.lineWidth / 2);
		const free = joined.filter((end) => !end.track.locked);
		for (const end of free) this.record(this.reroutes, end, to);
		if (hold ? hold(to) : free.length === joined.length) return;
		if (
			this.links.some(
				(link) =>
					link.track.layer === track.layer &&
					near(link.from, from) &&
					near(link.to, to),
			)
		)
			return;
		this.links.push({ from, to, track });
	}

	routeFor(track: Track, from: Point, to: Point, prefer?: Point): TrackRoute {
		return {
			from,
			to,
			layer: track.layer,
			width: track.lineWidth,
			net: track.net,
			prefer,
			ignore: this.ignore,
		};
	}

	private place(track: Track, path: readonly Point[], keep: boolean) {
		const [first, ...rest] = segments(path);
		if (keep)
			this.result.push(
				first
					? withEnds(track, first[0], first[1])
					: withEnds(track, path[0], path[0]),
			);
		else if (first) rest.unshift(first);
		for (const [from, to] of rest) {
			if (keep) this.owners.set(this.nextShapeId + this.added.length, track.id);
			this.added.push(
				trackSegment(
					this.nextShapeId + this.added.length,
					from,
					to,
					track.layer,
					track.lineWidth,
					track.net,
				),
			);
		}
	}

	private route(track: Track, from: Point, to: Point, prefer?: Point) {
		const { points, clear } = routeTrack(
			this.routeFor(track, from, to, prefer),
			this.routing,
			this.budget,
		);
		if (!clear) this.unsafe = true;
		return points;
	}

	reroute(track: Track, from: Point, to: Point, prefer?: Point) {
		this.place(track, this.route(track, from, to, prefer), true);
	}

	private copperOf(id: number): [Point, Point][] {
		const copper: [Point, Point][] = [];
		for (const shape of [...this.result, ...this.added])
			if (
				isBoardTrack(shape) &&
				shape.width > join &&
				(shape.id === id || this.owners.get(shape.id) === id)
			)
				copper.push(lineEnds(shape));
		if (copper.length) return copper;
		const collapsed = this.result.find(
			(shape) => shape.id === id && isBoardTrack(shape),
		);
		if (!collapsed) return copper;
		const [point] = lineEnds(collapsed);
		return [[point, point]];
	}

	private unplace(id: number) {
		this.result = this.result.filter((shape) => shape.id !== id);
		for (const [index, shape] of this.added.entries())
			if (this.owners.get(shape.id) === id && isBoardTrack(shape)) {
				const [point] = lineEnds(shape);
				this.added[index] = withEnds(shape, point, point);
			}
	}

	private carry(old: Track) {
		const copper = this.copperOf(old.id);
		if (!copper.length) return;
		const half = old.lineWidth / 2;
		const onCopper = (point: Point, reach: number) =>
			copper.some(([a, b]) => segmentDistance(point, a, b) <= reach);
		const nearest = (point: Point) =>
			copper
				.map(([a, b]) => nearestOn([a, b], point))
				.reduce((best, candidate) =>
					Math.hypot(candidate.x - point.x, candidate.y - point.y) <
					Math.hypot(best.x - point.x, best.y - point.y)
						? candidate
						: best,
				);
		for (const branch of branchesOn(this.index, old)) {
			const { track } = branch;
			if (this.selected.has(track.id) || this.stretches.has(track.id)) continue;
			if (this.reroutes.get(track.id)?.ends[branch.index]) continue;
			const reach = (old.lineWidth + track.lineWidth) / 2 - 1e-6;
			if (onCopper(branch.point, reach)) continue;
			this.follow(old, branch.point, nearest(branch.point), [branch]);
		}
		const [a, b] = lineEnds(old);
		const body = { points: [a, b], radius: half };
		for (const anchor of this.index.anchors) {
			if (this.selected.has(anchor.owner)) continue;
			if (!anchor.layers.includes(old.layer)) continue;
			const { centre, hulls } = anchor;
			if (segmentDistance(centre, a, b) > 10) continue;
			if (!hulls.some((hull) => hullDistance(body, hull) <= join)) continue;
			if (
				hulls.some(
					(hull) =>
						pointHullDistance(hull, a) <= half + join ||
						pointHullDistance(hull, b) <= half + join,
				)
			)
				continue;
			const kept = copper.some((points) =>
				hulls.some(
					(hull) => hullDistance({ points, radius: half }, hull) <= join,
				),
			);
			if (!kept)
				this.links.push({ from: centre, to: nearest(centre), track: old });
		}
	}

	finish(): EditorShape[] {
		for (const id of [...this.reroutes.keys(), ...this.stretches.keys()])
			this.ignore.add(id);
		for (const { track, ends } of this.stretches.values()) {
			const [a, b] = lineEnds(track);
			this.result.push(withEnds(track, ends[0] ?? a, ends[1] ?? b));
		}
		const routed = new Map<number, string>();
		const carried = new Set<number>();
		const keyOf = (ends: Ends) =>
			ends.map((end) => (end ? `${end.x},${end.y}` : "-")).join("|");
		for (let progressed = true; progressed; ) {
			progressed = false;
			for (const { track, ends } of [...this.reroutes.values()]) {
				if (this.stretches.has(track.id)) continue;
				const key = keyOf(ends);
				if (routed.get(track.id) === key) continue;
				if (routed.has(track.id)) {
					this.unplace(track.id);
					carried.delete(track.id);
					this.rigid.delete(track.id);
				}
				routed.set(track.id, key);
				this.ignore.add(track.id);
				progressed = true;
				const [a, b] = lineEnds(track);
				if (ends[0] && ends[1]) {
					const shiftA = { x: ends[0].x - a.x, y: ends[0].y - a.y };
					const shiftB = { x: ends[1].x - b.x, y: ends[1].y - b.y };
					if (near(shiftA, shiftB)) {
						this.result.push(withEnds(track, ends[0], ends[1]));
						this.rigid.add(track.id);
					} else
						this.reroute(track, ends[0], ends[1], {
							x: b.x - a.x,
							y: b.y - a.y,
						});
					continue;
				}
				const moving = ends[0] ? 0 : 1;
				const fixed = moving === 0 ? b : a;
				const old = moving === 0 ? a : b;
				const path = this.route(track, fixed, ends[moving] as Point, {
					x: old.x - fixed.x,
					y: old.y - fixed.y,
				});
				this.place(track, moving === 0 ? [...path].reverse() : path, true);
			}
			for (const shape of [...this.result]) {
				if (!isBoardTrack(shape) || carried.has(shape.id)) continue;
				carried.add(shape.id);
				progressed = true;
				const old = this.index.byId.get(shape.id);
				if (old && isBoardTrack(old)) this.carry(old);
			}
		}
		for (const { from, to, track } of this.links)
			this.place(track, this.route(track, from, to), false);
		for (const shape of this.result) {
			if (!this.rigid.has(shape.id) || isCollapsedTrack(shape)) continue;
			const copper = {
				hulls: shapeHulls(shape),
				layers: isVia(shape) ? shapeLayers(shape) : [shape.layer ?? ""],
				net: "net" in shape ? shape.net : undefined,
			};
			if (!copperClear(copper, this.ignore, this.routing)) this.unsafe = true;
		}
		const result = this.merged();
		if (this.unsafe) markUnsafeMove(result);
		return result;
	}

	private merged(): EditorShape[] {
		const tracks = new Map<number, Track>();
		for (const shape of [...this.result, ...this.added])
			if (isBoardTrack(shape)) tracks.set(shape.id, shape);
		const vias = this.result.filter(isVia);
		const pinned = (point: Point, layer: string) =>
			this.index.anchors.some(
				(anchor) =>
					!this.selected.has(anchor.owner) && covers(anchor, point, layer),
			) ||
			vias.some((via) =>
				shapeHulls(via).some((hull) => pointHullDistance(hull, point) <= join),
			);
		const endingAt = (point: Point, layer: string) => {
			const found: { track: Track; far: Point }[] = [];
			const add = (track: Track) => {
				if (track.layer !== layer || track.width <= join) return;
				const [a, b] = lineEnds(track);
				if (near(a, point)) found.push({ track, far: b });
				else if (near(b, point)) found.push({ track, far: a });
			};
			for (const track of tracks.values()) add(track);
			for (const { track } of endsAt(this.index, point))
				if (!tracks.has(track.id)) add(track);
			return found;
		};
		const keeps = (a: Track, b: Track) =>
			this.selected.has(a.id) !== this.selected.has(b.id)
				? this.selected.has(a.id)
				: a.id < b.id;
		const queue = [...tracks.values()].flatMap((track) =>
			lineEnds(track).map((point) => ({ point, layer: track.layer })),
		);
		for (let next = queue.pop(); next; next = queue.pop()) {
			const { point, layer } = next;
			const meeting = endingAt(point, layer);
			if (meeting.length !== 2) continue;
			const [first, second] = meeting;
			if (
				first.track.id === second.track.id ||
				first.track.locked ||
				second.track.locked ||
				first.track.net !== second.track.net ||
				Math.abs(first.track.lineWidth - second.track.lineWidth) > 1e-9
			)
				continue;
			const u = { x: first.far.x - point.x, y: first.far.y - point.y };
			const v = { x: second.far.x - point.x, y: second.far.y - point.y };
			const cross = u.x * v.y - u.y * v.x;
			if (Math.abs(cross) > 1e-6 * Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))
				continue;
			const [keep, drop] = keeps(first.track, second.track)
				? [first, second]
				: [second, first];
			if (u.x * v.x + u.y * v.y > 0) {
				const longer =
					Math.hypot(u.x, u.y) >= Math.hypot(v.x, v.y) ? first : second;
				const shorter = longer === first ? second : first;
				tracks.set(keep.track.id, orient(keep.track, point, longer.far));
				tracks.set(
					drop.track.id,
					withEnds(drop.track, shorter.far, shorter.far),
				);
				queue.push({ point: longer.far, layer }, { point: shorter.far, layer });
				continue;
			}
			if (pinned(point, layer)) continue;
			tracks.set(drop.track.id, withEnds(drop.track, drop.far, drop.far));
			tracks.set(keep.track.id, orient(keep.track, keep.far, drop.far));
			queue.push({ point: keep.far, layer }, { point: drop.far, layer });
		}
		const existing = new Set(this.result.map((shape) => shape.id));
		const fresh = new Set(this.added.map((shape) => shape.id));
		return [
			...this.result.map((shape) => tracks.get(shape.id) ?? shape),
			...[...tracks.values()].filter(
				(track) => !existing.has(track.id) && !fresh.has(track.id),
			),
			...this.added.flatMap((shape) => {
				const track = tracks.get(shape.id) ?? shape;
				return track.width <= join ? [] : [track];
			}),
		];
	}
}

function nearestOn(path: readonly Point[], point: Point): Point {
	let best = path[0];
	let distance = Number.POSITIVE_INFINITY;
	for (let index = 1; index < path.length; index++) {
		const a = path[index - 1];
		const b = path[index];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const length = dx * dx + dy * dy || 1;
		const t = Math.max(
			0,
			Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
		);
		const candidate = { x: a.x + t * dx, y: a.y + t * dy };
		const gap = Math.hypot(candidate.x - point.x, candidate.y - point.y);
		if (gap < distance) {
			distance = gap;
			best = candidate;
		}
	}
	return best;
}

function orient(track: Track, from: Point, to: Point): Track {
	const [a, b] = lineEnds(track);
	return (to.x - from.x) * (b.x - a.x) + (to.y - from.y) * (b.y - a.y) >= 0
		? withEnds(track, from, to)
		: withEnds(track, to, from);
}

function segments(path: readonly Point[]): [Point, Point][] {
	const result: [Point, Point][] = [];
	for (let index = 1; index < path.length; index++)
		if (!near(path[index - 1], path[index]))
			result.push([path[index - 1], path[index]]);
	return result;
}

const recent = new WeakMap<
	readonly EditorShape[],
	{ key: string; routing?: TrackRouting; result: EditorShape[] }
>();

function remembered(
	allShapes: readonly EditorShape[],
	key: string,
	routing: TrackRouting | undefined,
	compute: () => EditorShape[],
) {
	const last = recent.get(allShapes);
	if (last?.key === key && last.routing === routing) return last.result;
	const result = measurePerformance("editor.track-drag", compute, {
		shapes: allShapes.length,
	});
	recent.set(allShapes, { key, routing, result });
	return result;
}

export function dragTracks(
	shapes: readonly EditorShape[],
	moved: EditorShape[],
	allShapes: readonly EditorShape[],
	delta: Point,
	nextShapeId: number,
	routing?: TrackRouting,
): EditorShape[] {
	return remembered(
		allShapes,
		`move ${shapes.map((shape) => shape.id)} ${delta.x} ${delta.y} ${nextShapeId}`,
		routing,
		() => moveTracks(shapes, moved, allShapes, delta, nextShapeId, routing),
	);
}

function slideTrack(rework: Rework, single: Track, delta: Point): boolean {
	const ends = lineEnds(single);
	const [a, b] = ends;
	const length = Math.hypot(b.x - a.x, b.y - a.y);
	if (length <= join) return false;
	const direction = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
	if (Math.abs(delta.x * direction.y - delta.y * direction.x) <= join)
		return false;
	const slides = ends.map((point) => {
		const target = { x: point.x + delta.x, y: point.y + delta.y };
		const joined = rework.joinedAt(
			point,
			single.layer,
			single.net,
			single.lineWidth / 2,
		);
		if (
			rework.holdAt(point, single.layer, single.lineWidth / 2) ||
			joined.length !== 1 ||
			joined[0].track.locked
		)
			return { target, joined };
		const slid = slideAlong(joined[0], target, direction);
		if (!slid) return { target, joined };
		const neighbour = joined[0].track;
		const far = lineEnds(neighbour)[joined[0].index === 0 ? 1 : 0];
		const clear = trackClear(
			{
				...rework.routeFor(neighbour, far, slid),
				ignore: new Set([...rework.ignore, neighbour.id]),
			},
			[far, slid],
			rework.routing,
		);
		return clear ? { target: slid, joined, slid: true } : { target, joined };
	});
	const forward =
		(slides[1].target.x - slides[0].target.x) * direction.x +
		(slides[1].target.y - slides[0].target.y) * direction.y;
	if (forward <= join) return false;
	const sliding = slides.flatMap(({ slid, joined }) =>
		slid ? [joined[0].track.id] : [],
	);
	if (
		!trackClear(
			{
				...rework.routeFor(single, slides[0].target, slides[1].target),
				ignore: new Set([...rework.ignore, ...sliding]),
			},
			[slides[0].target, slides[1].target],
			rework.routing,
			false,
		)
	)
		return false;
	rework.result.push(withEnds(single, slides[0].target, slides[1].target));
	rework.rigid.add(single.id);
	for (const [end, point] of ends.entries()) {
		const { target, joined, slid } = slides[end];
		if (slid) rework.stretch(joined[0], target);
		else rework.follow(single, point, target, joined);
	}
	return true;
}

function moveTracks(
	shapes: readonly EditorShape[],
	moved: EditorShape[],
	allShapes: readonly EditorShape[],
	delta: Point,
	nextShapeId: number,
	routing?: TrackRouting,
): EditorShape[] {
	const rework = new Rework(
		boardIndex(allShapes),
		shapes.map((shape) => shape.id),
		nextShapeId,
		routing,
	);
	const single = shapes.length === 1 ? shapes[0] : undefined;
	if (single && isBoardTrack(single) && slideTrack(rework, single, delta))
		return rework.finish();
	rework.result.push(...moved);
	for (const shape of moved)
		if (isBoardTrack(shape) || isVia(shape)) rework.rigid.add(shape.id);
	const shift = (point: Point) => ({
		x: point.x + delta.x,
		y: point.y + delta.y,
	});
	for (const shape of shapes) {
		if (isBoardTrack(shape))
			for (const point of lineEnds(shape))
				rework.follow(shape, point, shift(point));
		else if (isVia(shape)) {
			const from = { x: shape.x, y: shape.y };
			const to = { x: from.x + delta.x, y: from.y + delta.y };
			const byLayer = new Map<string, TrackEnd[]>();
			const sameNet = (track: Track) =>
				shape.net === undefined ||
				track.net === undefined ||
				track.net === shape.net;
			for (const joined of rework.joinedAt(
				from,
				undefined,
				shape.net,
				shape.width / 2,
			)) {
				const list = byLayer.get(joined.track.layer);
				if (list) list.push(joined);
				else byLayer.set(joined.track.layer, [joined]);
			}
			for (const joined of byLayer.values())
				rework.follow(joined[0].track, from, to, joined);
			const templates = [...byLayer.values()].flat().map((end) => end.track);
			for (const body of bodiesAt(rework.index, from, shape.width / 2))
				if (
					!rework.ignore.has(body.id) &&
					!byLayer.has(body.layer) &&
					sameNet(body)
				) {
					byLayer.set(body.layer, []);
					templates.push(body);
					rework.follow(body, from, to, []);
				}
			const template = templates[0];
			if (template)
				for (const anchor of rework.index.anchors) {
					if (rework.ignore.has(anchor.owner)) continue;
					if (
						!anchor.hulls.some((hull) => pointHullDistance(hull, from) <= join)
					)
						continue;
					if (anchor.layers.some((layer) => byLayer.has(layer))) continue;
					const layer = anchor.layers.find((candidate) =>
						isCopperLayer(candidate as FootprintLayer),
					);
					if (!layer) continue;
					byLayer.set(layer, []);
					rework.follow(
						{ ...template, layer: layer as CopperLayer },
						from,
						to,
						[],
					);
				}
		}
	}
	return rework.finish();
}

export function dragTrackEnd(
	track: EditorShape,
	end: 0 | 1,
	target: Point,
	allShapes: readonly EditorShape[],
	nextShapeId: number,
	gridStep: number,
	routing?: TrackRouting,
): EditorShape[] {
	if (!isBoardTrack(track)) return [track];
	const ends = lineEnds(track);
	const dragged = ends[end];
	const fixed = ends[end === 0 ? 1 : 0];
	const point = gridStep > 0 ? snapPoint(target, gridStep) : target;
	if (near(point, dragged) || near(point, fixed)) return [track];
	return remembered(
		allShapes,
		`end ${track.id} ${end} ${point.x} ${point.y} ${nextShapeId}`,
		routing,
		() => {
			const rework = new Rework(
				boardIndex(allShapes),
				[track.id],
				nextShapeId,
				routing,
			);
			const joined = rework.joinedAt(
				dragged,
				track.layer,
				track.net,
				track.lineWidth / 2,
			);
			for (const other of joined)
				if (!other.track.locked) rework.ignore.add(other.track.id);
			rework.reroute(track, fixed, point, {
				x: dragged.x - fixed.x,
				y: dragged.y - fixed.y,
			});
			rework.follow(track, dragged, point, joined);
			return rework.finish();
		},
	);
}
