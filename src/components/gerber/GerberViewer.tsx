import type { Ref } from "react";
import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { GraphicsRenderer, SceneLayer } from "#/engine";
import type { GerberViewerHandle } from "../viewer/types/GerberViewerHandle";
import type { ViewerSnapshot } from "../viewer/types/ViewerSnapshot";
import { useGerberCamera } from "../viewer/useGerberCamera";
import { useGerberRenderer } from "../viewer/useGerberRenderer";
import { useNetHover } from "../viewer/useNetHover";

export function GerberViewer({
	layer,
	layers: suppliedLayers,
	focusedLayerId,
	ref,
	onChange,
}: {
	layer?: SceneLayer;
	layers?: readonly SceneLayer[];
	focusedLayerId?: string;
	ref?: Ref<GerberViewerHandle>;
	onChange?: (snapshot: ViewerSnapshot) => void;
}) {
	const layers = useMemo(
		() => suppliedLayers ?? (layer ? [layer] : []),
		[suppliedLayers, layer],
	);
	const hoverLayers = useMemo(
		() =>
			focusedLayerId
				? layers.filter((entry) => entry.id === focusedLayerId)
				: layers,
		[layers, focusedLayerId],
	);
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
	} = useGerberCamera(layers);
	const hoveredIds = useNetHover(
		container,
		renderer,
		hoverLayers,
		camera,
		size,
	);
	const { canvasHost, backend, message, diagnostics } = useGerberRenderer(
		renderer,
		layers,
		camera,
		size,
		hoveredIds,
		focusedLayerId,
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
