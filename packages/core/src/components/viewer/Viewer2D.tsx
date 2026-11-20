import { omit } from "solid-js";
import {
	SceneViewport,
	type SceneViewportHandle,
	type SceneViewportProps,
} from "#/components/viewer/SceneViewport.tsx";
import type { Viewer2DHandle } from "#/components/viewer/types/Viewer2DHandle.ts";

export interface Viewer2DProps
	extends Omit<SceneViewportProps, "cameraMode" | "ref"> {
	ref?: (handle: Viewer2DHandle) => void;
	focusOutline?: boolean;
}

export function Viewer2D(props: Viewer2DProps) {
	let viewer: SceneViewportHandle | undefined;
	props.ref?.({
		resetView: () => viewer?.fit(),
		zoomView: (factor) => viewer?.zoom(factor),
		panView: (x, y) => viewer?.pan(x, y),
	});
	const rest = omit(props, "ref", "ariaLabel", "focusOutline");
	const ariaLabel = () => props.ariaLabel ?? "2D drawing viewport";
	return (
		<div
			class={[
				"absolute inset-0 min-h-0 touch-none overscroll-contain select-none",
				(props.focusOutline ?? true)
					? "[&_canvas:focus-visible]:outline-2 [&_canvas:focus-visible]:-outline-offset-2 [&_canvas:focus-visible]:outline-accent"
					: "[&_canvas]:outline-none [&_canvas:focus-visible]:outline-none",
			]}
			role="application"
			aria-label={ariaLabel()}
		>
			<SceneViewport
				{...rest}
				ref={(handle) => {
					viewer = handle;
				}}
				cameraMode="top"
				ariaLabel={ariaLabel()}
			/>
		</div>
	);
}
