import { type Ref, useImperativeHandle, useRef } from "react";
import {
	SceneViewport,
	type SceneViewportHandle,
	type SceneViewportProps,
} from "#/components/viewer/SceneViewport.tsx";
import type { Viewer2DHandle } from "#/components/viewer/types/Viewer2DHandle.ts";

export interface Viewer2DProps
	extends Omit<SceneViewportProps, "cameraMode" | "projection" | "ref"> {
	ref?: Ref<Viewer2DHandle>;
}

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
		<div
			className="absolute inset-0 min-h-0 touch-none overscroll-contain select-none [&_canvas:focus-visible]:outline-2 [&_canvas:focus-visible]:-outline-offset-2 [&_canvas:focus-visible]:outline-[#e8b77e]"
			role="application"
			aria-label={ariaLabel}
		>
			<SceneViewport
				{...props}
				ref={viewer}
				cameraMode="top"
				ariaLabel={ariaLabel}
			/>
		</div>
	);
}
