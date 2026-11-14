import {
	containsSelection,
	type EditorShape,
	intersectsSelection,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Bounds, Point } from "@ecad/drawing-core/drawing/types.ts";
import type { LengthUnit } from "@ecad/drawing-core/drawing/units.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import { shapeLayers } from "@ecad/drawing-core/footprint/shapes.ts";
import { rulerSpacing } from "#/engine/ruler.ts";
import { type ViewMapping, viewMapping } from "#/engine/view-projection.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";
import { outlineInBox, shapeOutline } from "#/footprint/outline.ts";

export interface CanvasProjection extends ViewMapping {
	scale: number;
	turned: boolean;
	layerHeight(layers: readonly FootprintLayer[]): number;
	heightOf(shape: EditorShape): number;
	nearestLast<Shape extends EditorShape>(
		shapes: readonly Shape[],
	): readonly Shape[];
	screenOutline(shape: EditorShape): Point[] | null;
	inScreenBox(
		shape: EditorShape,
		box: Bounds,
		mode: "window" | "crossing",
	): boolean;
}

export type SurfaceHeights = (
	layers: readonly FootprintLayer[],
	eyeZ: number,
) => number;

function outlineOnScreen(
	mapping: ViewMapping,
	shape: EditorShape,
	height: number,
) {
	const points = shapeOutline(shape).map((corner) =>
		mapping.toScreen(corner, height),
	);
	return points.every((point) => point !== null) ? points : null;
}

function project(
	view: Viewer2DSnapshot,
	surfaces: SurfaceHeights | null,
): CanvasProjection {
	const mapping = viewMapping(view);
	const flat = {
		...mapping,
		scale: view.camera.scale,
		turned: false,
		layerHeight: () => 0,
		heightOf: () => 0,
		nearestLast: <Shape extends EditorShape>(shapes: readonly Shape[]) =>
			shapes,
		screenOutline: (shape: EditorShape) => outlineOnScreen(mapping, shape, 0),
		inScreenBox: (
			shape: EditorShape,
			box: Bounds,
			mode: "window" | "crossing",
		) => {
			const from = mapping.toWorld({ x: box.minX, y: box.minY });
			const to = mapping.toWorld({ x: box.maxX, y: box.maxY });
			return (
				from !== null &&
				to !== null &&
				(mode === "window" ? containsSelection : intersectsSelection)(shape, {
					minX: Math.min(from.x, to.x),
					maxX: Math.max(from.x, to.x),
					minY: Math.min(from.y, to.y),
					maxY: Math.max(from.y, to.y),
				})
			);
		},
	};
	if (!view.projection) return flat;
	const { eyeZ } = view.projection;
	const layerHeight = (layers: readonly FootprintLayer[]) =>
		surfaces?.(layers, eyeZ) ?? 0;
	const heightOf = (shape: EditorShape) => layerHeight(shapeLayers(shape));
	const screenOutline = (shape: EditorShape) =>
		outlineOnScreen(mapping, shape, heightOf(shape));
	return {
		...flat,
		turned: true,
		layerHeight,
		heightOf,
		nearestLast: (shapes) => {
			const distances = new Map(
				shapes.map((shape) => [shape, Math.abs(eyeZ - heightOf(shape))]),
			);
			return [...shapes].sort(
				(a, b) => (distances.get(b) ?? 0) - (distances.get(a) ?? 0),
			);
		},
		screenOutline,
		inScreenBox: (shape, box, mode) => {
			const outline = screenOutline(shape);
			return outline !== null && outlineInBox(outline, box, mode);
		},
	};
}

export type CanvasView = ReturnType<typeof createCanvasView>;

export function createCanvasView(unit: LengthUnit = "mil") {
	let snapshot: Viewer2DSnapshot | null = null;
	let surfaces: SurfaceHeights | null = null;
	let projection: CanvasProjection | null = null;
	const listeners = new Set<() => void>();
	const changed = () => {
		projection = null;
		for (const listener of listeners) listener();
	};
	return {
		getSnapshot: () => snapshot,
		getProjection: () => {
			if (snapshot) projection ??= project(snapshot, surfaces);
			return projection;
		},
		getGridStep: () =>
			snapshot ? rulerSpacing(snapshot.camera.scale, unit).minor : 0,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		update(value: Viewer2DSnapshot) {
			if (
				snapshot &&
				snapshot.camera.x === value.camera.x &&
				snapshot.camera.y === value.camera.y &&
				snapshot.camera.scale === value.camera.scale &&
				snapshot.viewport.width === value.viewport.width &&
				snapshot.viewport.height === value.viewport.height &&
				snapshot.projection?.eyeZ === value.projection?.eyeZ &&
				(snapshot.projection?.matrix ?? []).every(
					(entry, index) => entry === value.projection?.matrix[index],
				) &&
				!snapshot.projection === !value.projection
			)
				return;
			snapshot = value;
			changed();
		},
		clear() {
			if (!snapshot) return;
			snapshot = null;
			changed();
		},
		setSurfaces(value: SurfaceHeights | null) {
			if (value === surfaces) return;
			surfaces = value;
			changed();
		},
	};
}
