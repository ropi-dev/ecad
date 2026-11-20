import { boardPads } from "#/board/footprints.ts";
import {
	type Hull,
	lineEnds,
	pointHullDistance,
	shapeHulls,
	trackSegment,
} from "#/board/geometry.ts";
import { routeTrack, type TrackRouting } from "#/board/track-router.ts";
import type { EditorShape, LineShape } from "#/drawing/schema.ts";
import { snapPoint } from "#/drawing/shape-geometry.ts";
import type { Point } from "#/drawing/types.ts";
import {
	type CopperLayer,
	type FootprintLayer,
	isCopperLayer,
} from "#/footprint/layers.ts";
import { isVia, shapeLayers } from "#/footprint/shapes.ts";

type Track = LineShape & { layer: CopperLayer };

export const isBoardTrack = (shape: EditorShape): shape is Track =>
	shape.kind === "line" && isCopperLayer(shape.layer as FootprintLayer);

const join = 1e-4;

const near = (a: Point, b: Point) =>
	Math.abs(a.x - b.x) <= join && Math.abs(a.y - b.y) <= join;

const cellOf = (point: Point) =>
	`${Math.round(point.x / join)},${Math.round(point.y / join)}`;

interface TrackEnd {
	readonly track: Track;
	readonly index: 0 | 1;
	readonly point: Point;
}

interface Anchor {
	readonly owner: number;
	readonly layers: readonly string[];
	readonly hulls: readonly Hull[];
}

interface BoardIndex {
	readonly ends: Map<string, TrackEnd[]>;
	readonly anchors: readonly Anchor[];
}

const indexes = new WeakMap<readonly EditorShape[], BoardIndex>();

function boardIndex(allShapes: readonly EditorShape[]): BoardIndex {
	const cached = indexes.get(allShapes);
	if (cached) return cached;
	const ends = new Map<string, TrackEnd[]>();
	const anchors: Anchor[] = [];
	for (const shape of allShapes) {
		if (isVia(shape))
			anchors.push({
				owner: shape.id,
				layers: shapeLayers(shape),
				hulls: shapeHulls(shape),
			});
		if (!isBoardTrack(shape)) continue;
		for (const [index, point] of lineEnds(shape).entries()) {
			const key = cellOf(point);
			const end = { track: shape, index: index as 0 | 1, point };
			const list = ends.get(key);
			if (list) list.push(end);
			else ends.set(key, [end]);
		}
	}
	for (const pad of boardPads(allShapes))
		anchors.push({
			owner: pad.footprint.id,
			layers: shapeLayers(pad.shape),
			hulls: shapeHulls(pad.shape),
		});
	const index = { ends, anchors };
	indexes.set(allShapes, index);
	return index;
}

function endsAt(index: BoardIndex, point: Point): TrackEnd[] {
	const x = Math.round(point.x / join);
	const y = Math.round(point.y / join);
	const found: TrackEnd[] = [];
	for (let dx = -1; dx <= 1; dx++)
		for (let dy = -1; dy <= 1; dy++)
			for (const end of index.ends.get(`${x + dx},${y + dy}`) ?? [])
				if (near(end.point, point)) found.push(end);
	return found;
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
	point: Point,
	target: Point,
	direction: Point,
): Point | undefined {
	const far = lineEnds(joined.track)[joined.index === 0 ? 1 : 0];
	const along = { x: point.x - far.x, y: point.y - far.y };
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
	readonly result: EditorShape[] = [];
	readonly ignore: Set<number>;
	private readonly added: EditorShape[] = [];
	private readonly reroutes = new Map<number, { track: Track; ends: Ends }>();
	private readonly stretches = new Map<number, { track: Track; ends: Ends }>();
	private readonly links: { from: Point; to: Point; track: Track }[] = [];

	constructor(
		readonly index: BoardIndex,
		selected: Iterable<number>,
		private readonly nextShapeId: number,
		private readonly routing: TrackRouting | undefined,
	) {
		this.ignore = new Set(selected);
	}

	anchorAt(point: Point, layer: string) {
		return this.index.anchors.find(
			(anchor) =>
				!this.ignore.has(anchor.owner) && covers(anchor, point, layer),
		);
	}

	joinedAt(point: Point, layer?: string) {
		return endsAt(this.index, point).filter(
			({ track }) =>
				!this.ignore.has(track.id) && (!layer || track.layer === layer),
		);
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

	rerouteEnd(joined: TrackEnd, to: Point) {
		this.record(this.reroutes, joined, to);
	}

	follow(
		track: Track,
		from: Point,
		to: Point,
		joined = this.joinedAt(from, track.layer),
	) {
		const anchor = this.anchorAt(from, track.layer);
		const free = joined.filter((end) => !end.track.locked);
		for (const end of free) this.rerouteEnd(end, to);
		if (anchor ? !covers(anchor, to, track.layer) : free.length < joined.length)
			this.links.push({ from, to, track });
	}

	private place(track: Track, path: readonly Point[], keep: boolean) {
		const [first, ...rest] = segments(path);
		if (keep)
			this.result.push(
				first ? withEnds(track, first[0], first[1]) : { ...track, width: 0 },
			);
		else if (first) rest.unshift(first);
		for (const [from, to] of rest)
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

	private route(track: Track, from: Point, to: Point, prefer?: Point) {
		return routeTrack(
			{
				from,
				to,
				layer: track.layer,
				width: track.lineWidth,
				net: track.net,
				prefer,
				ignore: this.ignore,
			},
			this.routing,
		);
	}

	reroute(track: Track, from: Point, to: Point, prefer?: Point) {
		this.place(track, this.route(track, from, to, prefer), true);
	}

	finish(): EditorShape[] {
		for (const id of [...this.reroutes.keys(), ...this.stretches.keys()])
			this.ignore.add(id);
		for (const { track, ends } of this.stretches.values()) {
			const [a, b] = lineEnds(track);
			this.result.push(withEnds(track, ends[0] ?? a, ends[1] ?? b));
		}
		for (const { track, ends } of this.reroutes.values()) {
			if (this.stretches.has(track.id)) continue;
			const [a, b] = lineEnds(track);
			if (ends[0] && ends[1]) {
				this.result.push(withEnds(track, ends[0], ends[1]));
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
		for (const { from, to, track } of this.links)
			this.place(track, this.route(track, from, to), false);
		return [...this.result, ...this.added];
	}
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
	const result = compute();
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

function moveTracks(
	shapes: readonly EditorShape[],
	moved: EditorShape[],
	allShapes: readonly EditorShape[],
	delta: Point,
	nextShapeId: number,
	routing?: TrackRouting,
): EditorShape[] {
	const index = boardIndex(allShapes);
	const rework = new Rework(
		index,
		shapes.map((shape) => shape.id),
		nextShapeId,
		routing,
	);
	const single = shapes.length === 1 ? shapes[0] : undefined;
	if (single && isBoardTrack(single)) {
		const ends = lineEnds(single);
		const [a, b] = ends;
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		const direction = length
			? { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
			: { x: 1, y: 0 };
		const slides = ends.map((point) => {
			const target = { x: point.x + delta.x, y: point.y + delta.y };
			const joined = rework.joinedAt(point, single.layer);
			if (
				rework.anchorAt(point, single.layer) ||
				joined.length !== 1 ||
				joined[0].track.locked
			)
				return { target, joined };
			const slid = slideAlong(joined[0], point, target, direction);
			return slid ? { target: slid, joined, slid: true } : { target, joined };
		});
		const forward =
			(slides[1].target.x - slides[0].target.x) * direction.x +
			(slides[1].target.y - slides[0].target.y) * direction.y;
		if (forward > join) {
			rework.result.push(withEnds(single, slides[0].target, slides[1].target));
			for (const [end, point] of ends.entries()) {
				const { target, joined, slid } = slides[end];
				if (slid) rework.stretch(joined[0], target);
				else rework.follow(single, point, target, joined);
			}
			return rework.finish();
		}
	}
	rework.result.push(...moved);
	for (const shape of shapes) {
		if (isBoardTrack(shape))
			for (const point of lineEnds(shape))
				rework.follow(shape, point, {
					x: point.x + delta.x,
					y: point.y + delta.y,
				});
		else if (isVia(shape)) {
			const from = { x: shape.x, y: shape.y };
			const to = { x: from.x + delta.x, y: from.y + delta.y };
			for (const joined of rework.joinedAt(from))
				if (!joined.track.locked)
					rework.follow(joined.track, from, to, [joined]);
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
			const joined = rework
				.joinedAt(dragged, track.layer)
				.filter((other) => !other.track.locked);
			for (const other of joined) rework.ignore.add(other.track.id);
			rework.reroute(track, fixed, point, {
				x: dragged.x - fixed.x,
				y: dragged.y - fixed.y,
			});
			for (const other of joined) rework.rerouteEnd(other, point);
			return rework.finish();
		},
	);
}
