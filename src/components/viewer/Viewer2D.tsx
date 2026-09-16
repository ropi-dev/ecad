import { type Ref, useImperativeHandle, useRef, useState } from "react";
import {
	SceneViewport,
	type SceneViewportHandle,
	type SceneViewportProps,
} from "./SceneViewport";
import type { Viewer2DHandle } from "./types/Viewer2DHandle";

export interface Viewer2DProps
	extends Omit<SceneViewportProps, "cameraMode" | "projection" | "ref"> {
	ref?: Ref<Viewer2DHandle>;
}

export function Viewer2D({
	ref,
	ariaLabel = "2D drawing viewport",
	...props
}: Viewer2DProps) {
	const [orthographic, setOrthographic] = useState(false);
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
				projection={orthographic ? "orthographic" : "perspective"}
				ariaLabel={ariaLabel}
			/>
			<button
				type="button"
				aria-label="Orthographic camera"
				aria-pressed={orthographic}
				title={
					orthographic
						? "Switch to perspective camera"
						: "Switch to orthographic camera"
				}
				onClick={() => setOrthographic((value) => !value)}
				className="absolute bottom-16 left-9 z-10 min-h-10 sm:bottom-3 rounded-lg border border-white/20 bg-slate-900 px-3 text-sm font-semibold text-white/80 hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
			>
				{orthographic ? "Orthographic" : "Perspective"}
			</button>
		</div>
	);
}
