import { omit } from "solid-js";
import {
	SceneViewport,
	type SceneViewportHandle,
	type SceneViewportProps,
} from "#/components/viewer/SceneViewport.tsx";
import type { Viewer3DHandle } from "#/components/viewer/types/Viewer3DHandle.ts";
import type { ViewerScene } from "#/engine/scene.ts";

export interface Viewer3DProps
	extends Omit<SceneViewportProps, "cameraMode" | "ref" | "onChange"> {
	scene: ViewerScene;
	ref?: (handle: Viewer3DHandle) => void;
}

export function Viewer3D(props: Viewer3DProps) {
	let viewer: SceneViewportHandle | undefined;
	props.ref?.({
		fit: () => viewer?.fit(),
		zoom: (factor) => viewer?.zoom(factor),
		view: (direction) => viewer?.view(direction),
	});
	const rest = omit(props, "ref");
	return (
		<SceneViewport
			{...rest}
			ref={(handle) => {
				viewer = handle;
			}}
			cameraMode="orbit"
		/>
	);
}
