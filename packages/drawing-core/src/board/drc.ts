import {
	analyzeConnectivity,
	type CopperItem,
	copperItems,
	itemDistance,
	nearbyPairs,
	sharesLayer,
	type ZoneReach,
} from "#/board/connectivity.ts";
import { isBoardFootprint } from "#/board/footprints.ts";
import {
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
	| "outline";

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

export interface DrcOptions {
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
	nearbyPairs(items, rules.clearance, (a, b) => {
		const zones = a.kind === "zone" && b.kind === "zone";
		if (!zones && (a.kind === "zone" || b.kind === "zone")) return;
		if (a.net !== undefined && a.net === b.net) return;
		if (a.shapeId === b.shapeId) return;
		if (!sharesLayer(a, b)) return;
		const distance =
			zones && options.zoneReach?.gap
				? options.zoneReach.gap(a, b)
				: itemDistance(a, b);
		if (distance >= rules.clearance - 1e-6) return;
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
				: `Clearance ${Math.max(0, distance).toFixed(3)} mm between ${describe(a)} on ${netName(netlist, a.net)} and ${describe(b)} on ${netName(netlist, b.net)}, needs ${rules.clearance} mm`,
			shapeIds: [...new Set([a.shapeId, b.shapeId])],
			at,
		});
	});
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
	const { ratsnest } = analyzeConnectivity(items, options.zoneReach);
	ratsnest.forEach((line, index) => {
		findings.push({
			id: `unconnected:${line.net}:${index}`,
			kind: "unconnected",
			message: `Unrouted connection on ${netName(netlist, line.net)}`,
			shapeIds: [],
			at: {
				x: (line.from.x + line.to.x) / 2,
				y: (line.from.y + line.to.y) / 2,
			},
		});
	});
	return findings;
}
