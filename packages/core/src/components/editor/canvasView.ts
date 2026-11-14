import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import type { LengthUnit } from "@ecad/drawing-core/drawing/units.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import { screenToWorld, worldToScreen } from "#/engine/camera.ts";
import { rulerSpacing } from "#/engine/ruler.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";

export interface CanvasProjection {
	width: number;
	height: number;
	scale: number;
	tilted: boolean;
	toWorld: (screen: Point, plane?: number) => Point | null;
	toScreen: (point: Point, plane?: number) => Point | null;
	planeOf: (shape: EditorShape) => number | undefined;
	layerPlane: (layer?: FootprintLayer) => number;
	nearestFirst: (planes: Iterable<number>) => number[];
}

export type CanvasView = ReturnType<typeof createCanvasView>;

function flatProjection({
	camera,
	viewport: { width, height },
}: Viewer2DSnapshot): CanvasProjection {
	return {
		width,
		height,
		scale: camera.scale,
		tilted: false,
		toWorld: (screen) => screenToWorld(screen, camera, width, height),
		toScreen: (point) => worldToScreen(point, camera, width, height),
		planeOf: () => 0,
		layerPlane: () => 0,
		nearestFirst: (planes) => [...planes],
	};
}

export function createCanvasView(unit: LengthUnit = "mil") {
	let snapshot: Viewer2DSnapshot | null = null;
	let flat: CanvasProjection | null = null;
	let tilted: CanvasProjection | null = null;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const getProjection = () => tilted ?? flat;
	return {
		getSnapshot: () => snapshot,
		getProjection,
		getGridStep: () => {
			const projection = getProjection();
			return projection ? rulerSpacing(projection.scale, unit).minor : 0;
		},
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
				snapshot.viewport.height === value.viewport.height
			)
				return;
			snapshot = value;
			flat = flatProjection(value);
			notify();
		},
		setProjection(value: CanvasProjection | null) {
			if (value === tilted) return;
			tilted = value;
			notify();
		},
	};
}
