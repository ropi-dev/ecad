import type { CopperItem } from "#/board/connectivity.ts";
import {
	type Hull,
	hullDistance,
	lineEnds,
	pointHullDistance,
	shapeHulls,
	trackSegment,
} from "#/board/geometry.ts";
import {
	type RouteBudget,
	routeTrack,
	type TrackRouting,
	touchingItems,
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
type Segment = readonly [Point, Point];

export const isBoardTrack = (shape: EditorShape): shape is Track =>
	shape.kind === "line" && isCopperLayer(shape.layer as FootprintLayer);

const join = 1e-4;

export const isCollapsedTrack = (shape: EditorShape) =>
	isBoardTrack(shape) && shape.width <= join;

const near = (a: Point, b: Point) =>
	Math.abs(a.x - b.x) <= join && Math.abs(a.y - b.y) <= join;

const sameNet = (a: string | undefined, b: string | undefined) =>
	a === undefined || b === undefined || a === b;

interface Copper {
	readonly hulls: readonly Hull[];
	readonly layers: readonly string[];
}

const copperOf = (shape: EditorShape): Copper => ({
	hulls: shapeHulls(shape),
	layers: isVia(shape) ? shapeLayers(shape) : [shape.layer ?? ""],
});

const touches = (a: Copper, b: Copper) =>
	a.layers.some((layer) => b.layers.includes(layer)) &&
	a.hulls.some((hull) =>
		b.hulls.some((other) => hullDistance(hull, other) <= join),
	);

const covers = (copper: Copper, point: Point) =>
	copper.hulls.some((hull) => pointHullDistance(hull, point) <= join);

function nearestOn([a, b]: Segment, point: Point): Point {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const length = dx * dx + dy * dy || 1;
	const t = Math.max(
		0,
		Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
	);
	return { x: a.x + t * dx, y: a.y + t * dy };
}

const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function closestOn(line: Segment, other: Segment): Point {
	return [nearestOn(line, other[0]), nearestOn(line, other[1]), ...line]
		.map((point) => ({ point, gap: gap(point, nearestOn(other, point)) }))
		.reduce((best, candidate) => (candidate.gap < best.gap ? candidate : best))
		.point;
}

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

function segments(path: readonly Point[]): Segment[] {
	const result: Segment[] = [];
	for (let index = 1; index < path.length; index++)
		if (!near(path[index - 1], path[index]))
			result.push([path[index - 1], path[index]]);
	return result;
}

interface Piece {
	readonly id?: number;
	readonly line: Segment;
	readonly before: Copper;
	readonly after: Copper;
	readonly net?: string;
	readonly track?: Track;
	readonly shift?: (point: Point) => Point;
}

interface Follower {
	readonly item: CopperItem;
	readonly track: Track;
	readonly ends: [Point | undefined, Point | undefined];
	readonly rides: Set<Piece>;
	path: readonly Point[];
	backwards: boolean;
	clear: boolean;
	copper: Copper;
}

function rework(
	pieces: readonly Piece[],
	placed: readonly EditorShape[],
	routing: TrackRouting,
	nextShapeId: number,
	stretched = new Map<CopperItem, Segment>(),
	dragged?: number,
): EditorShape[] | undefined {
	const selected = new Set(placed.map((shape) => shape.id));
	const attached = (copper: Copper, net: string | undefined) =>
		touchingItems(copper, routing).filter(
			(item) => !selected.has(item.shapeId) && sameNet(item.net, net),
		);
	const followers = new Map<number, Follower>();
	const follow = (item: CopperItem) => {
		const known = followers.get(item.shapeId);
		if (known) return known;
		const follower: Follower = {
			item,
			track: item.shape as Track,
			ends: [undefined, undefined],
			rides: new Set(),
			path: [],
			backwards: false,
			clear: true,
			copper: item,
		};
		followers.set(item.shapeId, follower);
		return follower;
	};
	for (const piece of pieces) {
		const { shift } = piece;
		if (!shift) continue;
		for (const item of attached(piece.before, piece.net)) {
			if (item.kind !== "track" || item.shape.locked) continue;
			for (const [index, end] of lineEnds(item.shape).entries()) {
				if (!covers(piece.before, end)) continue;
				const follower = follow(item);
				follower.ends[index] = shift(end);
				follower.rides.add(piece);
			}
		}
	}
	for (const [item, ends] of stretched) follow(item).path = ends;

	const budget: RouteBudget = { remaining: 30_000 };
	const ignore = new Set([...selected, ...followers.keys()]);
	const route = (track: Track, from: Point, to: Point, prefer?: Point) =>
		routeTrack(
			{
				from,
				to,
				layer: track.layer,
				width: track.lineWidth,
				net: track.net,
				prefer,
				ignore,
			},
			routing,
			budget,
		);
	for (const follower of followers.values()) {
		const { track, ends } = follower;
		const [a, b] = lineEnds(track);
		if (follower.path.length === 0) {
			const [toA, toB] = ends;
			if (
				toA &&
				toB &&
				near(toA, { x: a.x + toB.x - b.x, y: a.y + toB.y - b.y })
			)
				follower.path = [toA, toB];
			else {
				const found = toB
					? route(track, toA ?? a, toB, { x: b.x - a.x, y: b.y - a.y })
					: route(track, b, toA ?? a, { x: a.x - b.x, y: a.y - b.y });
				follower.path = found.points;
				follower.backwards = !toB;
				follower.clear = found.clear;
			}
		}
		const lines = segments(follower.path);
		follower.copper = {
			layers: [track.layer],
			hulls: (lines.length ? lines : [[follower.path[0]]]).map((points) => ({
				points,
				radius: track.lineWidth / 2,
			})),
		};
	}

	const moved = new Map(
		pieces.flatMap((piece) =>
			piece.id === undefined ? [] : [[piece.id, piece.after] as const],
		),
	);
	const reached = pieces.find((piece) => piece.id === undefined)?.before;
	const keeps = (follower: Follower) =>
		touchingItems(follower.item, routing).every((item) => {
			if (item === follower.item || !sameNet(item.net, follower.track.net))
				return true;
			if (follower.track.id === dragged && reached && touches(item, reached))
				return true;
			const now =
				followers.get(item.shapeId)?.copper ??
				(selected.has(item.shapeId) ? moved.get(item.shapeId) : item);
			return !now || touches(follower.copper, now);
		});
	for (let dropped = true; dropped; ) {
		dropped = false;
		for (const [id, follower] of followers) {
			if (keeps(follower)) continue;
			if (stretched.has(follower.item)) return undefined;
			followers.delete(id);
			dropped = true;
		}
	}

	const result: EditorShape[] = [...placed];
	const added: Track[] = [];
	let unsafe = false;
	const place = (track: Track, path: readonly Point[], kept?: Follower) => {
		const [first = [path[0], path[0]] as const, ...rest] = segments(path);
		if (kept)
			result.push(
				kept.backwards
					? withEnds(track, first[1], first[0])
					: withEnds(track, first[0], first[1]),
			);
		else if (!near(first[0], first[1])) rest.unshift(first);
		for (const [from, to] of rest)
			added.push(
				trackSegment(
					nextShapeId + added.length,
					from,
					to,
					track.layer,
					track.lineWidth,
					track.net,
				) as Track,
			);
	};
	for (const follower of followers.values()) {
		place(follower.track, follower.path, follower);
		if (!follower.clear) unsafe = true;
	}

	const links: { from: Point; to: Point; track: Track }[] = [];
	for (const piece of pieces) {
		const { shift } = piece;
		if (!shift) continue;
		const holders = attached(piece.before, piece.net);
		const riders = [...followers.values()].filter((follower) =>
			follower.rides.has(piece),
		);
		const group = [piece.after, ...riders.map((follower) => follower.copper)];
		for (const item of holders) {
			if (followers.has(item.shapeId)) continue;
			if (group.some((copper) => touches(item, copper))) continue;
			const ends = item.kind === "track" ? lineEnds(item.shape) : undefined;
			const centre = item.points[0] ?? piece.line[0];
			const at = ends
				? closestOn(piece.line, ends)
				: nearestOn(piece.line, centre);
			const from = ends ? nearestOn(ends, at) : covers(item, at) ? at : centre;
			const layer =
				piece.track?.layer ??
				item.layers.find((candidate) =>
					piece.before.layers.includes(candidate),
				);
			const template =
				piece.track ??
				[item, ...holders].find((holder) => holder.kind === "track")?.shape ??
				riders[0]?.track;
			const to = shift(at);
			if (!layer || !template || !isBoardTrack(template)) continue;
			if (
				links.some(
					(link) =>
						link.track.layer === layer &&
						near(link.from, from) &&
						near(link.to, to),
				)
			)
				continue;
			links.push({ from, to, track: { ...template, layer } });
		}
	}
	for (const { from, to, track } of links) {
		const found = route(track, from, to);
		place(track, found.points);
		if (!found.clear) unsafe = true;
	}

	const merged = merge(result, added, selected, routing);
	if (unsafe) markUnsafeMove(merged);
	return merged;
}

function orient(track: Track, from: Point, to: Point): Track {
	const [a, b] = lineEnds(track);
	return (to.x - from.x) * (b.x - a.x) + (to.y - from.y) * (b.y - a.y) >= 0
		? withEnds(track, from, to)
		: withEnds(track, to, from);
}

function merge(
	result: readonly EditorShape[],
	added: readonly Track[],
	selected: ReadonlySet<number>,
	routing: TrackRouting,
): EditorShape[] {
	const tracks = new Map<number, Track>();
	for (const shape of [...result, ...added])
		if (isBoardTrack(shape)) tracks.set(shape.id, shape);
	const vias = result.filter(isVia).map(copperOf);
	const around = (point: Point, layer: string) =>
		touchingItems(
			{ hulls: [{ points: [point], radius: 0 }], layers: [layer] },
			routing,
		).filter((item) => !selected.has(item.shapeId));
	const pinned = (point: Point, layer: string) =>
		vias.some((via) => covers(via, point)) ||
		around(point, layer).some(
			(item) => item.kind !== "track" && covers(item, point),
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
		for (const { shape } of around(point, layer))
			if (isBoardTrack(shape) && !tracks.has(shape.id)) add(shape);
		return found;
	};
	const keeps = (a: Track, b: Track) =>
		selected.has(a.id) !== selected.has(b.id)
			? selected.has(a.id)
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
			tracks.set(drop.track.id, withEnds(drop.track, shorter.far, shorter.far));
			queue.push({ point: longer.far, layer }, { point: shorter.far, layer });
			continue;
		}
		if (pinned(point, layer)) continue;
		tracks.set(drop.track.id, withEnds(drop.track, drop.far, drop.far));
		tracks.set(keep.track.id, orient(keep.track, keep.far, drop.far));
		queue.push({ point: keep.far, layer }, { point: drop.far, layer });
	}
	const listed = new Set([...result, ...added].map((shape) => shape.id));
	return [
		...result.map((shape) => tracks.get(shape.id) ?? shape),
		...[...tracks.values()].filter((track) => !listed.has(track.id)),
		...added.flatMap((shape) => {
			const track = tracks.get(shape.id) ?? shape;
			return track.width <= join ? [] : [track];
		}),
	];
}

function slideAlong(
	far: Point,
	joined: Point,
	target: Point,
	direction: Point,
): Point | undefined {
	const along = { x: joined.x - far.x, y: joined.y - far.y };
	const length = Math.hypot(along.x, along.y);
	const cross = along.x * direction.y - along.y * direction.x;
	if (length <= join || Math.abs(cross) <= 1e-6 * length) return undefined;
	const scale =
		((target.x - far.x) * direction.y - (target.y - far.y) * direction.x) /
		cross;
	if (scale * length <= join) return undefined;
	return { x: far.x + along.x * scale, y: far.y + along.y * scale };
}

function slide(
	track: Track,
	delta: Point,
	routing: TrackRouting,
	nextShapeId: number,
): EditorShape[] | undefined {
	const ends = lineEnds(track);
	const length = gap(ends[0], ends[1]);
	if (length <= join) return undefined;
	const direction = {
		x: (ends[1].x - ends[0].x) / length,
		y: (ends[1].y - ends[0].y) / length,
	};
	if (Math.abs(delta.x * direction.y - delta.y * direction.x) <= join)
		return undefined;
	const shift = (point: Point) => ({
		x: point.x + delta.x,
		y: point.y + delta.y,
	});
	const before = copperOf(track);
	const reach = track.lineWidth / 2 + join;
	const targets = ends.map(shift);
	const stretched = new Map<CopperItem, Segment>();
	for (const [end, point] of ends.entries()) {
		const joined = touchingItems(
			{ hulls: [{ points: [point], radius: reach }], layers: before.layers },
			routing,
		).filter(
			(item) => item.shapeId !== track.id && sameNet(item.net, track.net),
		);
		const [item] = joined;
		if (joined.length !== 1 || item.kind !== "track" || item.shape.locked)
			continue;
		const other = lineEnds(item.shape);
		const index = other.findIndex(
			(candidate) => gap(point, candidate) <= reach,
		);
		if (index < 0 || stretched.has(item)) continue;
		const far = other[1 - index];
		const slid = slideAlong(far, other[index], targets[end], direction);
		if (!slid) continue;
		targets[end] = slid;
		stretched.set(item, index === 0 ? [slid, far] : [far, slid]);
	}
	if (!stretched.size) return undefined;
	const forward =
		(targets[1].x - targets[0].x) * direction.x +
		(targets[1].y - targets[0].y) * direction.y;
	if (forward <= join) return undefined;
	const after = withEnds(track, targets[0], targets[1]);
	return rework(
		[
			{
				id: track.id,
				line: ends,
				before,
				after: copperOf(after),
				net: track.net,
				track,
				shift: (point) => nearestOn([targets[0], targets[1]], shift(point)),
			},
		],
		[after],
		routing,
		nextShapeId,
		stretched,
	);
}

const recent = new WeakMap<
	readonly EditorShape[],
	{ key: string; routing: TrackRouting; result: EditorShape[] }
>();

function remembered(
	allShapes: readonly EditorShape[],
	key: string,
	routing: TrackRouting,
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
	moved: readonly EditorShape[],
	allShapes: readonly EditorShape[],
	delta: Point,
	nextShapeId: number,
	routing: TrackRouting,
): EditorShape[] {
	return remembered(
		allShapes,
		`move ${shapes.map((shape) => shape.id)} ${delta.x} ${delta.y} ${nextShapeId}`,
		routing,
		() => {
			const [single] = shapes;
			const slid =
				shapes.length === 1 && isBoardTrack(single)
					? slide(single, delta, routing, nextShapeId)
					: undefined;
			if (slid) return slid;
			const shift = (point: Point) => ({
				x: point.x + delta.x,
				y: point.y + delta.y,
			});
			const pieces = shapes.flatMap((shape, index): Piece[] => {
				if (!isBoardTrack(shape) && !isVia(shape)) return [];
				const centre = { x: shape.x, y: shape.y };
				return [
					{
						id: shape.id,
						line: isBoardTrack(shape) ? lineEnds(shape) : [centre, centre],
						before: copperOf(shape),
						after: copperOf(moved[index]),
						net: shape.net,
						track: isBoardTrack(shape) ? shape : undefined,
						shift,
					},
				];
			});
			return rework(pieces, moved, routing, nextShapeId) ?? [...moved];
		},
	);
}

export function dragTrackEnd(
	track: EditorShape,
	end: 0 | 1,
	target: Point,
	allShapes: readonly EditorShape[],
	nextShapeId: number,
	gridStep: number,
	routing: TrackRouting,
): EditorShape[] {
	if (!isBoardTrack(track)) return [track];
	const ends = lineEnds(track);
	const dragged = ends[end];
	const point = gridStep > 0 ? snapPoint(target, gridStep) : target;
	if (near(point, dragged) || near(point, ends[end === 0 ? 1 : 0]))
		return [track];
	const cap = (at: Point): Copper => ({
		hulls: [{ points: [at], radius: track.lineWidth / 2 }],
		layers: [track.layer],
	});
	return remembered(
		allShapes,
		`end ${track.id} ${end} ${point.x} ${point.y} ${nextShapeId}`,
		routing,
		() =>
			rework(
				[
					{
						line: [dragged, dragged],
						before: cap(dragged),
						after: cap(point),
						net: track.net,
						track,
						shift: () => point,
					},
				],
				[],
				routing,
				nextShapeId,
				undefined,
				track.id,
			) ?? [track],
	);
}
