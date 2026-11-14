import type { LengthUnit } from "@ecad/drawing-core/drawing/units.ts";
import { rulerSpacing } from "#/engine/ruler.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";

export type CanvasView = ReturnType<typeof createCanvasView>;

export function createCanvasView(unit: LengthUnit = "mil") {
	let snapshot: Viewer2DSnapshot | null = null;
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => snapshot,
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
				snapshot.viewport.height === value.viewport.height
			)
				return;
			snapshot = value;
			for (const listener of listeners) listener();
		},
	};
}
