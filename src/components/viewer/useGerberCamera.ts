import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fitCamera, getSceneBounds } from "../../engine/camera";
import type { Camera, SceneLayer } from "../../engine/types";
import { ViewportControls } from "../../engine/viewport-controls";

export function useGerberCamera(layers: readonly SceneLayer[]) {
	const container = useRef<HTMLDivElement>(null);
	const fittedLayer = useRef<string | null>(null);
	const controls = useRef<ViewportControls | null>(null);
	const [size, setSize] = useState({ width: 1, height: 1 });
	const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
	const [homeCamera, setHomeCamera] = useState<Camera>(camera);

	useEffect(() => {
		const target = container.current;
		if (!target) return;
		const navigation = new ViewportControls(target, setCamera);
		controls.current = navigation;
		fittedLayer.current = null;
		const observer = new ResizeObserver(([entry]) =>
			setSize({
				width: entry.contentRect.width,
				height: entry.contentRect.height,
			}),
		);
		observer.observe(target);
		return () => {
			observer.disconnect();
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
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const step = event.shiftKey ? 240 : 80;
		switch (event.key) {
			case "+":
			case "=":
				zoomView(1.25);
				break;
			case "-":
				zoomView(1 / 1.25);
				break;
			case "f":
			case "F":
			case "0":
				resetView();
				break;
			case "ArrowLeft":
				panView(-step, 0);
				break;
			case "ArrowRight":
				panView(step, 0);
				break;
			case "ArrowUp":
				panView(0, -step);
				break;
			case "ArrowDown":
				panView(0, step);
				break;
			default:
				return;
		}
		event.preventDefault();
	};
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
