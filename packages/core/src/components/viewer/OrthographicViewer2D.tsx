import { type Ref, useImperativeHandle, useRef } from "react";
import {
	SceneViewport,
	type SceneViewportHandle,
	type SceneViewportProps,
} from "#/components/viewer/SceneViewport.tsx";
import type { Viewer2DHandle } from "#/components/viewer/types/Viewer2DHandle.ts";

export interface OrthographicViewer2DProps
	extends Omit<
		SceneViewportProps,
		"cameraMode" | "projection" | "lockProjection" | "ref"
	> {
	ref?: Ref<Viewer2DHandle>;
}

/** A planar viewport with no perspective or orbit controls. Units are millimetres. */
export function OrthographicViewer2D({
	ref,
	ariaLabel = "Orthographic drawing viewport",
	...props
}: OrthographicViewer2DProps) {
	const viewer = useRef<SceneViewportHandle>(null);
	useImperativeHandle(
		ref,
		() => ({
			resetView: () => viewer.current?.fit(),
			zoomView: (factor) => viewer.current?.zoom(factor),
			panView: (x, y) => viewer.current?.pan(x, y),
		}),
		[],
	);
	return (
		<div
			className="absolute inset-0 min-h-0 touch-none overscroll-contain select-none [&_canvas]:outline-none [&_canvas:focus-visible]:outline-none"
			role="application"
			aria-label={ariaLabel}
		>
			<SceneViewport
				{...props}
				ref={viewer}
				ariaLabel={ariaLabel}
				cameraMode="top"
				projection="orthographic"
				lockProjection
			/>
		</div>
	);
}
