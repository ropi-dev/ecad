import { type Ref, useImperativeHandle, useRef } from "react";
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
