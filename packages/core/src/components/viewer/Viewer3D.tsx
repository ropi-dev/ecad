import { type Ref, useImperativeHandle, useRef } from "react";
import type { ViewerScene } from "#/engine/scene.ts";
import {
	SceneViewport,
	type SceneViewportHandle,
	type SceneViewportProps,
} from "./SceneViewport";
import type { Viewer3DHandle } from "./types/Viewer3DHandle";

export interface Viewer3DProps
	extends Omit<SceneViewportProps, "cameraMode" | "ref" | "onChange"> {
	scene: ViewerScene;
	ref?: Ref<Viewer3DHandle>;
}

export function Viewer3D({ ref, ...props }: Viewer3DProps) {
	const viewer = useRef<SceneViewportHandle>(null);
	useImperativeHandle(
		ref,
		() => ({
			fit: () => viewer.current?.fit(),
			zoom: (factor) => viewer.current?.zoom(factor),
			view: (direction) => viewer.current?.view(direction),
		}),
		[],
	);
	return <SceneViewport {...props} ref={viewer} cameraMode="orbit" />;
}
