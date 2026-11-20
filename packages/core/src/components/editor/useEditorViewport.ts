import {
	type Accessor,
	createMemo,
	createRenderEffect,
	createSignal,
} from "solid-js";
import {
	createCanvasView,
	type SurfaceHeights,
} from "#/components/editor/canvasView.ts";
import { type GridUnit, rulerSpacing } from "#/engine/ruler.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";
import { fromExternalStore } from "#/lib/external-store.ts";

const cameraStates = new WeakMap<
	object,
	{ camera?: Viewer2DSnapshot["camera"] }
>();

/**
 * The canvas camera and viewer state. The camera position is kept per drawing
 * store, so switching documents and back restores the previous view.
 */
export function useEditorViewport(
	store: Accessor<object>,
	unit: Accessor<GridUnit> = () => "schematic",
	surfaces: Accessor<SurfaceHeights | null> = () => null,
) {
	const cameraState = createMemo(() => {
		const key = store();
		let state = cameraStates.get(key);
		if (!state) {
			state = {};
			cameraStates.set(key, state);
		}
		return state;
	});
	const [ready, setReady] = createSignal(false);
	const [viewerError, setViewerError] = createSignal("");
	const cameraView = createCanvasView("schematic", surfaces);
	createRenderEffect(unit, (value) => {
		cameraView.setUnit(value);
	});
	const snapshot = fromExternalStore(
		cameraView.subscribe,
		cameraView.getSnapshot,
	);
	const gridStep = createMemo(() => {
		const current = snapshot();
		return current ? rulerSpacing(current.camera.scale, unit()).minor : 0;
	});
	return {
		get cameraState() {
			return cameraState();
		},
		cameraView,
		get gridStep() {
			return gridStep();
		},
		get ready() {
			return ready();
		},
		get viewerError() {
			return viewerError();
		},
		onReady(value: boolean) {
			setReady(value);
			if (value) setViewerError("");
		},
		onError(message: string) {
			setViewerError(message);
		},
	};
}
