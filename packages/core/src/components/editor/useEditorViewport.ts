import { useState, useSyncExternalStore } from "react";
import { createCanvasView } from "#/components/editor/canvasView.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";

const cameraStates = new WeakMap<
	object,
	{ camera?: Viewer2DSnapshot["camera"] }
>();

/**
 * The canvas camera and viewer state. The camera position is kept per drawing
 * store, so switching documents and back restores the previous view.
 */
export function useEditorViewport(store: object) {
	let cameraState = cameraStates.get(store);
	if (!cameraState) {
		cameraState = {};
		cameraStates.set(store, cameraState);
	}
	const [ready, setReady] = useState(false);
	const [viewerError, setViewerError] = useState("");
	const [cameraView] = useState(createCanvasView);
	const gridStep = useSyncExternalStore(
		cameraView.subscribe,
		cameraView.getGridStep,
		cameraView.getGridStep,
	);
	return {
		cameraState,
		cameraView,
		gridStep,
		ready,
		viewerError,
		onReady(value: boolean) {
			setReady(value);
			if (value) setViewerError("");
		},
		onError: setViewerError,
	};
}
