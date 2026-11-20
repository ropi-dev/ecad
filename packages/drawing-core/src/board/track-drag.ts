import { boardPads } from "#/board/footprints.ts";
import {
	type Hull,
	lineEnds,
	pointHullDistance,
	shapeHulls,
	trackSegment,
} from "#/board/geometry.ts";
import type { EditorShape, LineShape } from "#/drawing/schema.ts";
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

export function dragTracks(
	shapes: readonly EditorShape[],
	moved: EditorShape[],
	allShapes: readonly EditorShape[],
	delta: Point,
	nextShapeId: number,
): EditorShape[] {
	const index = boardIndex(allShapes);
	const selected = new Set(shapes.map((shape) => shape.id));
	const stretches = new Map<number, [Point | undefined, Point | undefined]>();
	const added: EditorShape[] = [];
	const result = [...moved];
	const anchorAt = (point: Point, layer: string) =>
		index.anchors.find(
			(anchor) => !selected.has(anchor.owner) && covers(anchor, point, layer),
		);
	const joinedAt = (point: Point, layer?: string) =>
		endsAt(index, point).filter(
			({ track }) =>
				!selected.has(track.id) && (!layer || track.layer === layer),
		);
	const stretch = (joined: readonly TrackEnd[], to: Point) => {
		for (const { track, index: end } of joined) {
			if (track.locked) continue;
			const ends = stretches.get(track.id) ?? [undefined, undefined];
			ends[end] = to;
			stretches.set(track.id, ends);
		}
	};
	const locked = (point: Point, layer: string) =>
		joinedAt(point, layer).some(({ track }) => track.locked);
	const follow = (track: Track, from: Point, to: Point) => {
		const anchor = anchorAt(from, track.layer);
		if (!anchor && !locked(from, track.layer)) {
			stretch(joinedAt(from, track.layer), to);
			return;
		}
		if (anchor && covers(anchor, to, track.layer)) return;
		added.push(
			trackSegment(
				nextShapeId + added.length,
				from,
				to,
				track.layer,
				track.lineWidth,
				track.net,
			),
		);
	};

	const single = shapes.length === 1 ? shapes[0] : undefined;
	if (single && isBoardTrack(single)) {
		const ends = lineEnds(single);
		const [a, b] = ends;
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		const direction = length
			? { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
			: { x: 1, y: 0 };
		const targets = ends.map((point) => {
			const target = { x: point.x + delta.x, y: point.y + delta.y };
			if (anchorAt(point, single.layer) || locked(point, single.layer))
				return target;
			const joined = joinedAt(point, single.layer);
			if (joined.length !== 1) return target;
			return slideAlong(joined[0], point, target, direction) ?? target;
		});
		const forward =
			(targets[1].x - targets[0].x) * direction.x +
			(targets[1].y - targets[0].y) * direction.y;
		if (forward > join) {
			result[0] = withEnds(single, targets[0], targets[1]);
			for (const [end, point] of ends.entries())
				follow(single, point, targets[end]);
			return finish(result, allShapes, stretches, added);
		}
	}

	for (const shape of shapes) {
		if (isBoardTrack(shape))
			for (const point of lineEnds(shape))
				follow(shape, point, { x: point.x + delta.x, y: point.y + delta.y });
		else if (isVia(shape)) {
			const from = { x: shape.x, y: shape.y };
			stretch(joinedAt(from), { x: from.x + delta.x, y: from.y + delta.y });
		}
	}
	return finish(result, allShapes, stretches, added);
}

function finish(
	result: EditorShape[],
	allShapes: readonly EditorShape[],
	stretches: ReadonlyMap<number, [Point | undefined, Point | undefined]>,
	added: readonly EditorShape[],
): EditorShape[] {
	if (!stretches.size && !added.length) return result;
	for (const shape of allShapes) {
		const ends = stretches.get(shape.id);
		if (!ends || !isBoardTrack(shape)) continue;
		const [a, b] = lineEnds(shape);
		result.push(withEnds(shape, ends[0] ?? a, ends[1] ?? b));
	}
	return [...result, ...added];
}
