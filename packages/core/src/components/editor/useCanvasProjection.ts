import { type Accessor, createMemo } from "solid-js";
import type {
	CanvasProjection,
	CanvasView,
} from "#/components/editor/canvasView.ts";
import { fromExternalStore } from "#/lib/external-store.ts";

export function useCanvasProjection(
	cameraView: () => CanvasView,
): Accessor<CanvasProjection | null> {
	const snapshot = createMemo(() => {
		const view = cameraView();
		return fromExternalStore(view.subscribe, view.getSnapshot);
	});
	return createMemo(() => {
		snapshot()();
		return cameraView().getProjection();
	});
}
