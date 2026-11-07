import {
	type EditorShape,
	openPins,
	openWireEnds,
	shapeBounds,
	symbolShapes,
	wireJunctions,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Bounds, Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	buildWireCrossings,
	type WireCrossings,
} from "#/drawing/wire-crossings.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export interface DrawingAnalysis {
	junctions: ReturnType<typeof wireJunctions>;
	crossings: Map<number, WireCrossings>;
	openEnds: ReturnType<typeof openWireEnds>;
	openPins: ReturnType<typeof openPins>;
}

const INCREMENTAL_LIMIT = 192;
const MARGIN = 5;

const boundsCache = new WeakMap<EditorShape, Bounds>();
const boundsOf = (shape: EditorShape) => {
	let bounds = boundsCache.get(shape);
	if (!bounds) {
		bounds = shapeBounds(shape);
		if (shape.kind === "symbol")
			for (const child of symbolShapes(shape)) {
				const part = shapeBounds(child);
				bounds = {
					minX: Math.min(bounds.minX, part.minX),
					minY: Math.min(bounds.minY, part.minY),
					maxX: Math.max(bounds.maxX, part.maxX),
					maxY: Math.max(bounds.maxY, part.maxY),
				};
			}
		boundsCache.set(shape, bounds);
	}
	return bounds;
};
const grow = (bounds: Bounds, margin: number): Bounds => ({
	minX: bounds.minX - margin,
	minY: bounds.minY - margin,
	maxX: bounds.maxX + margin,
	maxY: bounds.maxY + margin,
});
const overlaps = (a: Bounds, b: Bounds) =>
	a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const contains = (bounds: Bounds, point: Point) =>
	point.x >= bounds.minX &&
	point.x <= bounds.maxX &&
	point.y >= bounds.minY &&
	point.y <= bounds.maxY;
const finite = (bounds: Bounds) =>
	Number.isFinite(bounds.minX + bounds.minY + bounds.maxX + bounds.maxY);

function merged(boxes: Bounds[]) {
	let result = boxes.map((box) => ({ ...box }));
	for (let changed = true; changed; ) {
		changed = false;
		result.sort((a, b) => a.minX - b.minX);
		const next: Bounds[] = [];
		for (const box of result) {
			const other = next.find((candidate) => overlaps(candidate, box));
			if (!other) {
				next.push(box);
				continue;
			}
			other.minX = Math.min(other.minX, box.minX);
			other.minY = Math.min(other.minY, box.minY);
			other.maxX = Math.max(other.maxX, box.maxX);
			other.maxY = Math.max(other.maxY, box.maxY);
			changed = true;
		}
		result = next;
	}
	return result;
}

function fullAnalysis(shapes: EditorShape[]): DrawingAnalysis {
	const junctions = wireJunctions(shapes);
	return {
		junctions,
		crossings: measurePerformance(
			"editor.wire-crossings",
			() =>
				buildWireCrossings(
					shapes,
					junctions.map(({ point }) => point),
				),
			{ shapes: shapes.length },
		),
		openEnds: openWireEnds(shapes),
		openPins: openPins(shapes),
	};
}

function updateCrossings(
	previous: Map<number, WireCrossings>,
	shapes: EditorShape[],
	removed: readonly EditorShape[],
	near: (bounds: Bounds) => boolean,
	junctions: Point[],
) {
	const wires: EditorShape[] = shapes.filter((shape) => shape.kind === "wire");
	const touching = (bounds: Bounds) =>
		wires.filter((wire) => overlaps(grow(boundsOf(wire), MARGIN), bounds));
	const affected = new Set(wires.filter((wire) => near(boundsOf(wire))));
	for (const wire of [...affected])
		for (const other of touching(boundsOf(wire))) affected.add(other);
	const reach = new Set(affected);
	for (const wire of affected)
		for (const other of touching(boundsOf(wire))) reach.add(other);
	for (const wire of [...reach])
		for (const other of touching(boundsOf(wire))) reach.add(other);
	const local = shapes.filter((shape) => reach.has(shape));
	const computed = buildWireCrossings(local, junctions);
	const crossings = new Map(previous);
	for (const shape of removed) crossings.delete(shape.id);
	for (const wire of affected) {
		const crossing = computed.get(wire.id);
		if (crossing) crossings.set(wire.id, crossing);
		else crossings.delete(wire.id);
	}
	return crossings;
}

export function updateAnalysis(
	previousShapes: EditorShape[],
	previous: DrawingAnalysis,
	shapes: EditorShape[],
): DrawingAnalysis | undefined {
	if (Math.abs(previousShapes.length - shapes.length) > INCREMENTAL_LIMIT)
		return undefined;
	const before = new Set(previousShapes);
	const added = shapes.filter((shape) => !before.has(shape));
	if (added.length > INCREMENTAL_LIMIT) return undefined;
	const after = new Set(shapes);
	const removed = previousShapes.filter((shape) => !after.has(shape));
	const changed = [...added, ...removed];
	if (changed.length > INCREMENTAL_LIMIT) return undefined;
	if (!changed.length)
		return shapes.every((shape, index) => shape === previousShapes[index])
			? previous
			: undefined;
	const boxes = changed.map((shape) => grow(boundsOf(shape), MARGIN));
	if (!boxes.every(finite)) return undefined;
	const region = merged(boxes);
	const kept = shapes.filter((shape) => before.has(shape));
	const previousKept = previousShapes.filter((shape) => after.has(shape));
	if (
		kept.length !== previousKept.length ||
		kept.some((shape, index) => shape !== previousKept[index])
	)
		return undefined;
	const near = (bounds: Bounds) => region.some((box) => overlaps(box, bounds));
	const inRegion = (point: Point) => region.some((box) => contains(box, point));
	const local = shapes.filter((shape) => near(boundsOf(shape)));
	const junctions = [
		...previous.junctions.filter(({ point }) => !inRegion(point)),
		...wireJunctions(local).filter(({ point }) => inRegion(point)),
	];
	return {
		junctions,
		crossings: updateCrossings(
			previous.crossings,
			shapes,
			removed,
			near,
			junctions.map(({ point }) => point),
		),
		openEnds: [
			...previous.openEnds.filter(({ point }) => !inRegion(point)),
			...openWireEnds(local).filter(({ point }) => inRegion(point)),
		],
		openPins: [
			...previous.openPins.filter(({ point }) => !inRegion(point)),
			...openPins(local).filter(({ point }) => inRegion(point)),
		],
	};
}

const analysisCache = new WeakMap<EditorShape[], DrawingAnalysis>();
let latest: { shapes: EditorShape[]; analysis: DrawingAnalysis } | undefined;

export function analyzeDrawing(shapes: EditorShape[]): DrawingAnalysis {
	let analysis = analysisCache.get(shapes);
	if (!analysis) {
		analysis =
			(latest && updateAnalysis(latest.shapes, latest.analysis, shapes)) ??
			fullAnalysis(shapes);
		analysisCache.set(shapes, analysis);
	}
	latest = { shapes, analysis };
	return analysis;
}
