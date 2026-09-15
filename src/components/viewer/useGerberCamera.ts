import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fitCamera, getSceneBounds } from "../../engine/camera";
import { handleViewerKeyDown } from "../../engine/navigation";
import type { Camera, SceneLayer } from "../../engine/types";
import { ViewportControls } from "../../engine/viewport-controls";
import { useViewportSize } from "./useViewportSize";

export function useGerberCamera(layers: readonly SceneLayer[]) {
	const container = useRef<HTMLDivElement>(null);
	const fittedLayer = useRef<string | null>(null);
	const controls = useRef<ViewportControls | null>(null);
	const size = useViewportSize(container);
	const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
	const [homeCamera, setHomeCamera] = useState<Camera>(camera);

	useEffect(() => {
		const target = container.current;
		if (!target) return;
		const navigation = new ViewportControls(target, setCamera);
		controls.current = navigation;
		fittedLayer.current = null;
		return () => {
			navigation.dispose();
			controls.current = null;
		};
	}, []);
	const sceneKey = JSON.stringify(
		layers
			.map(({ id, bounds }) => ({ id, bounds }))
			.sort((a, b) => a.id.localeCompare(b.id)),
	);
	useEffect(() => {
		const navigation = controls.current;
		if (!navigation || size.width <= 1 || size.height <= 1) return;
		if (sceneKey === fittedLayer.current) {
			navigation.resize(size.width, size.height);
			return;
		}
		fittedLayer.current = sceneKey;
		const fitted = fitCamera(
			getSceneBounds(layers, false),
			size.width,
			size.height,
			Math.min(40, size.width / 10),
		);
		setHomeCamera(fitted);
		navigation.fit(fitted, size.width, size.height);
	}, [layers, sceneKey, size]);
	const resetView = useCallback(() => controls.current?.reset(), []);
	const zoomView = useCallback(
		(factor: number) => controls.current?.zoom(factor),
		[],
	);
	const panView = useCallback(
		(x: number, y: number) => controls.current?.pan(x, y),
		[],
	);
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) =>
		handleViewerKeyDown(event, {
			fit: resetView,
			zoom: zoomView,
			pan: panView,
		});
	return {
		container,
		size,
		camera,
		zoom: camera.scale / homeCamera.scale,
		resetView,
		zoomView,
		panView,
		onKeyDown,
	};
}
