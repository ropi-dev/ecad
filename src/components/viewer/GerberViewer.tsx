import type { Ref } from "react";
import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { GraphicsRenderer, SceneLayer } from "../../engine/types";
import type { GerberViewerHandle } from "./types/GerberViewerHandle";
import type { ViewerSnapshot } from "./types/ViewerSnapshot";
import { useGerberCamera } from "./useGerberCamera";
import { useGerberRenderer } from "./useGerberRenderer";
import { useNetHover } from "./useNetHover";

export function GerberViewer({
	layer,
	ref,
	onChange,
}: {
	layer: SceneLayer;
	ref?: Ref<GerberViewerHandle>;
	onChange?: (snapshot: ViewerSnapshot) => void;
}) {
	const renderer = useRef<GraphicsRenderer | null>(null);
	const {
		container,
		size,
		camera,
		zoom,
		resetView,
		zoomView,
		panView,
		onKeyDown,
	} = useGerberCamera(layer);
	const hoveredIds = useNetHover(container, renderer, layer, camera, size);
	const { canvasHost, backend, message, diagnostics } = useGerberRenderer(
		renderer,
		layer,
		camera,
		size,
		hoveredIds,
	);
	useImperativeHandle(ref, () => ({ resetView, zoomView, panView }), [
		resetView,
		zoomView,
		panView,
	]);
	const snapshot = useMemo<ViewerSnapshot>(
		() => ({
			backend,
			message,
			camera,
			zoom,
			viewport: size,
			highlighted: hoveredIds?.size ?? 0,
			diagnostics,
		}),
		[backend, message, camera, zoom, size, hoveredIds, diagnostics],
	);
	useEffect(() => {
		onChange?.(snapshot);
	}, [onChange, snapshot]);
	return (
		<div
			ref={container}
			className="drawing-area"
			role="application"
			aria-label="Gerber drawing viewport"
			onKeyDown={onKeyDown}
		>
			<div ref={canvasHost} className="absolute inset-0" />
		</div>
	);
}
