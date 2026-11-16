import {
	analyzeConnectivity,
	boardHoles,
	type CopperItem,
	copperItems,
	endsAt,
	itemDistance,
	nearbyPairs,
	sharesLayer,
	type ZoneReach,
	zoneClearance,
} from "#/board/connectivity.ts";
import {
	type BoardFootprint,
	footprintPads,
	isBoardFootprint,
} from "#/board/footprints.ts";
import {
	boundsOverlap,
	type Hull,
	hullDistance,
	lineEnds,
	rectangleCorners,
} from "#/board/geometry.ts";
import { type BoardNetlist, netName } from "#/board/netlist.ts";
import type { BoardRules } from "#/board/rules.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import { symbolShapes } from "#/drawing/symbol-instances.ts";
import type { Bounds, Point } from "#/drawing/types.ts";

export type DrcKind =
	| "short"
	| "clearance"
	| "unconnected"
	| "edge"
	| "outline"
	| "footprint"
	| "net";

export interface DrcFinding {
	id: string;
	kind: DrcKind;
	message: string;
	/** Top-level board shapes involved. */
	shapeIds: readonly number[];
	at: Point;
}

type Segment = readonly [Point, Point];

/** Every Edge.Cuts stroke on the board, as segments in board coordinates. */
export function boardOutlineSegments(
	shapes: readonly EditorShape[],
): Segment[] {
	const segments: Segment[] = [];
	const add = (shape: EditorShape) => {
		if (shape.layer !== "Edge.Cuts") return;
		if (shape.kind === "line") segments.push(lineEnds(shape));
		else if (shape.kind === "rectangle") {
			const corners = rectangleCorners(shape);
			for (const [index, corner] of corners.entries())
				segments.push([corner, corners[(index + 1) % 4]]);
		} else if (shape.kind === "circle") {
			const steps = 48;
			const radius = shape.width / 2;
			for (let index = 0; index < steps; index++) {
				const a = (2 * Math.PI * index) / steps;
				const b = (2 * Math.PI * (index + 1)) / steps;
				segments.push([
					{
						x: shape.x + radius * Math.cos(a),
						y: shape.y + radius * Math.sin(a),
					},
					{
						x: shape.x + radius * Math.cos(b),
						y: shape.y + radius * Math.sin(b),
					},
				]);
			}
		}
	};
	for (const shape of shapes) {
		if (isBoardFootprint(shape))
			for (const child of symbolShapes(shape)) add(child);
		else add(shape);
	}
	return segments;
}

export function outlineClosed(segments: readonly Segment[]): boolean {
	if (!segments.length) return false;
	const degree = new Map<string, number>();
	for (const segment of segments)
		for (const point of segment) {
			const key = `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`;
			degree.set(key, (degree.get(key) ?? 0) + 1);
		}
	return [...degree.values()].every((count) => count % 2 === 0);
}

export function outlineBounds(
	segments: readonly Segment[],
): Bounds | undefined {
	if (!segments.length) return undefined;
	const xs = segments.flatMap(([a, b]) => [a.x, b.x]);
	const ys = segments.flatMap(([a, b]) => [a.y, b.y]);
	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
	};
}

/** Even-odd containment against the outline strokes. */
export function insideOutline(
	point: Point,
	segments: readonly Segment[],
): boolean {
	let inside = false;
	for (const [a, b] of segments) {
		if (a.y > point.y === b.y > point.y) continue;
		const x = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
		if (x > point.x) inside = !inside;
	}
	return inside;
}

const center = (bounds: Bounds): Point => ({
	x: (bounds.minX + bounds.maxX) / 2,
	y: (bounds.minY + bounds.maxY) / 2,
});

const describe = (item: CopperItem) =>
	item.kind === "pad" && item.pad
		? `pad ${item.pad.footprint.attributes.reference}.${item.pad.number}`
		: item.kind;

interface DrcOptions {
	zoneReach?: ZoneReach;
}

export function checkBoard(
	shapes: readonly EditorShape[],
	netlist: BoardNetlist,
	rules: BoardRules,
	options: DrcOptions = {},
): DrcFinding[] {
	const findings: DrcFinding[] = [];
	const items = copperItems(shapes, netlist);
	const widest = Math.max(rules.clearance, ...items.map(zoneClearance));
	nearbyPairs(items, widest, (a, b) => {
		const zone = a.kind === "zone" || b.kind === "zone";
		if (zone && !options.zoneReach?.gap && a.kind !== b.kind) return;
		if (a.net !== undefined && a.net === b.net) return;
		if (!sharesLayer(a, b)) return;
		if (
			a.shapeId === b.shapeId &&
			(a.net === undefined || b.net === undefined || itemDistance(a, b) > 1e-6)
		)
			return;
		const needed = Math.max(
			rules.clearance,
			zoneClearance(a),
			zoneClearance(b),
		);
		const distance =
			zone && options.zoneReach?.gap
				? options.zoneReach.gap(a, b, needed)
				: itemDistance(a, b);
		if (distance >= needed - 1e-6) return;
		const short = distance <= 1e-6;
		const at = center({
			minX: Math.max(a.bounds.minX, b.bounds.minX),
			minY: Math.max(a.bounds.minY, b.bounds.minY),
			maxX: Math.min(a.bounds.maxX, b.bounds.maxX),
			maxY: Math.min(a.bounds.maxY, b.bounds.maxY),
		});
		findings.push({
			id: `${short ? "short" : "clearance"}:${a.index}:${b.index}`,
			kind: short ? "short" : "clearance",
			message: short
				? `Short between ${describe(a)} on ${netName(netlist, a.net)} and ${describe(b)} on ${netName(netlist, b.net)}`
				: `Clearance ${Math.max(0, distance).toFixed(3)} mm between ${describe(a)} on ${netName(netlist, a.net)} and ${describe(b)} on ${netName(netlist, b.net)}, needs ${needed} mm`,
			shapeIds: [...new Set([a.shapeId, b.shapeId])],
			at,
		});
	});
	for (const hole of boardHoles(shapes))
		for (const item of items) {
			if (item.shapeId === hole.shapeId) continue;
			const zone = item.kind === "zone";
			if (zone && !options.zoneReach?.gap) continue;
			const needed = Math.max(rules.clearance, zoneClearance(item));
			if (!boundsOverlap(item.bounds, hole.bounds, needed)) continue;
			const distance =
				zone && options.zoneReach?.gap
					? options.zoneReach.gap(item, hole, needed)
					: itemDistance(item, hole);
			if (distance >= needed - 1e-6) continue;
			findings.push({
				id: `hole:${hole.index}:${item.index}`,
				kind: "clearance",
				message:
					distance <= 1e-6
						? `${describe(item)} on ${netName(netlist, item.net)} overlaps an unplated hole`
						: `Clearance ${distance.toFixed(3)} mm between ${describe(item)} on ${netName(netlist, item.net)} and an unplated hole, needs ${needed} mm`,
				shapeIds: [...new Set([item.shapeId, hole.shapeId])],
				at: center(hole.bounds),
			});
		}
	const outline = boardOutlineSegments(shapes);
	if (!outline.length)
		findings.push({
			id: "outline",
			kind: "outline",
			message: "The board has no outline. Draw one on the Edge.Cuts layer.",
			shapeIds: [],
			at: { x: 0, y: 0 },
		});
	else {
		if (!outlineClosed(outline))
			findings.push({
				id: "outline-open",
				kind: "outline",
				message:
					"The board outline is not closed. Zones stay unfilled until its ends meet.",
				shapeIds: [],
				at: outline[0][0],
			});
		const strokes: Hull[] = outline.map((segment) => ({
			points: segment,
			radius: 0,
		}));
		for (const item of items) {
			if (item.kind === "zone") continue;
			const inside = item.hulls.every((hull) =>
				hull.points.every((point) => insideOutline(point, outline)),
			);
			let gap = Infinity;
			for (const hull of item.hulls)
				for (const stroke of strokes)
					gap = Math.min(gap, hullDistance(hull, stroke));
			if (inside && gap >= rules.edgeClearance - 1e-6) continue;
			findings.push({
				id: `edge:${item.index}`,
				kind: "edge",
				message: inside
					? `${describe(item)} is ${Math.max(0, gap).toFixed(3)} mm from the board edge, needs ${rules.edgeClearance} mm`
					: `${describe(item)} is outside the board outline`,
				shapeIds: [item.shapeId],
				at: center(item.bounds),
			});
		}
	}
	for (const item of items) {
		if (item.net !== undefined && !netlist.nets.has(item.net))
			findings.push({
				id: `net:${item.index}`,
				kind: "net",
				message: `${describe(item)} is on a net the circuit no longer has`,
				shapeIds: [item.shapeId],
				at: center(item.bounds),
			});
		else if (item.kind === "zone" && options.zoneReach?.islands(item) === 0)
			findings.push({
				id: `zone:${item.index}`,
				kind: "net",
				message: `zone on ${netName(netlist, item.net)} has no copper: nothing on its net is inside it`,
				shapeIds: [item.shapeId],
				at: center(item.bounds),
			});
	}
	const placed = new Map<string, BoardFootprint>();
	for (const shape of shapes)
		if (isBoardFootprint(shape) && shape.component)
			placed.set(shape.component, shape as BoardFootprint);
	for (const component of netlist.components.values()) {
		const netted = component.pins.filter((pin) =>
			netlist.padNet(component.id, pin.number),
		);
		const footprint = placed.get(component.id);
		if (!footprint) {
			findings.push({
				id: `footprint:${component.id}`,
				kind: "footprint",
				message: `${component.reference} has no footprint on the board`,
				shapeIds: [],
				at: { x: 0, y: 0 },
			});
			continue;
		}
		const pads = new Set(footprintPads(footprint).map((pad) => pad.number));
		for (const pin of netted)
			if (!pads.has(pin.number))
				findings.push({
					id: `pad:${component.id}:${pin.number}`,
					kind: "footprint",
					message: `${component.reference} pin ${pin.number} on ${netName(netlist, netlist.padNet(component.id, pin.number))} has no pad`,
					shapeIds: [footprint.id],
					at: { x: footprint.x, y: footprint.y },
				});
	}
	const { ratsnest } = analyzeConnectivity(items, options.zoneReach);
	const ends = (net: string, point: Point) =>
		items.filter((item) => item.net === net && endsAt(item, point));
	ratsnest.forEach((line, index) => {
		findings.push({
			id: `unconnected:${line.net}:${index}`,
			kind: "unconnected",
			message: `Unrouted connection on ${netName(netlist, line.net)}`,
			shapeIds: [
				...new Set(
					[...ends(line.net, line.from), ...ends(line.net, line.to)].map(
						(item) => item.shapeId,
					),
				),
			],
			at: {
				x: (line.from.x + line.to.x) / 2,
				y: (line.from.y + line.to.y) / 2,
			},
		});
	});
	return findings;
}
