import { type Ref, useImperativeHandle, useRef } from "react";
import {
	SceneViewport,
	type SceneViewportHandle,
	type SceneViewportProps,
} from "./SceneViewport";
import type { Viewer2DHandle } from "./types/Viewer2DHandle";

export interface Viewer2DProps
	extends Omit<SceneViewportProps, "cameraMode" | "ref"> {
	ref?: Ref<Viewer2DHandle>;
}

/** The shared perspective viewport, constrained to look down the Z axis. */
export function Viewer2D({
	ref,
	ariaLabel = "2D drawing viewport",
	...props
}: Viewer2DProps) {
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
		<div className="drawing-area" role="application" aria-label={ariaLabel}>
			<SceneViewport
				{...props}
				ref={viewer}
				cameraMode="top"
				ariaLabel={ariaLabel}
			/>
		</div>
	);
}
