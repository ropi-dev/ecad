import {
	type Ref,
	useEffect,
	useEffectEvent,
	useImperativeHandle,
	useRef,
} from "react";
import {
	Box3,
	DirectionalLight,
	GridHelper,
	HemisphereLight,
	type Object3D,
	PerspectiveCamera,
	Scene,
	Sphere,
	Vector3,
	WebGLRenderer,
} from "three";
import { create3DControls } from "#/engine/controls3d.ts";
import { handleViewerKeyDown, viewerPixelRatio } from "#/engine/navigation.ts";
import { createSceneDisplay, type ViewerScene } from "#/engine/scene";
import { AxisIndicator } from "./AxisIndicator";
import type { AxisIndicatorHandle } from "./types/AxisIndicatorHandle";
import type { Viewer2DSnapshot } from "./types/Viewer2DSnapshot";
import type { Viewer3DHandle } from "./types/Viewer3DHandle";
import { useRenderFrame } from "./useRenderFrame";
import { useViewportSize } from "./useViewportSize";

export interface SceneViewportHandle extends Viewer3DHandle {
	pan: (x: number, y: number) => void;
}

export interface SceneViewportProps {
	scene: ViewerScene;
	cameraMode: "top" | "orbit";
	onChange?: (snapshot: Viewer2DSnapshot) => void;
	/** Updates the existing object without replacing the scene or resetting the camera. */
	updateScene?: (object: Object3D) => void;
	ref?: Ref<SceneViewportHandle>;
	onReady?: (ready: boolean) => void;
	onError?: (message: string) => void;
	ariaLabel?: string;
}

export function SceneViewport({
	scene: sourceScene,
	cameraMode,
	onChange,
	updateScene,
	ref,
	onReady,
	onError,
	ariaLabel = "3D model",
}: SceneViewportProps) {
	const host = useRef<HTMLDivElement>(null);
	const size = useViewportSize(host);
	const { draw, schedule, cancel } = useRenderFrame();
	const axes = useRef<AxisIndicatorHandle>(null);
	const reportChange = useEffectEvent((snapshot: Viewer2DSnapshot) =>
		onChange?.(snapshot),
	);
	const reportReady = useEffectEvent((ready: boolean) => onReady?.(ready));
	const reportError = useEffectEvent((message: string) => onError?.(message));
	const runtime = useRef<
		| (SceneViewportHandle & {
				update: (update: (object: Object3D) => void) => void;
				resize: (width: number, height: number) => void;
		  })
		| null
	>(null);
	useImperativeHandle(
		ref,
		() => ({
			fit: () => runtime.current?.fit(),
			zoom: (factor) => runtime.current?.zoom(factor),
			view: (direction) => runtime.current?.view(direction),
			pan: (x, y) => runtime.current?.pan(x, y),
		}),
		[],
	);
	const sceneUpdate = useRef(updateScene);
	useEffect(() => {
		sceneUpdate.current = updateScene;
		if (updateScene) runtime.current?.update(updateScene);
	}, [updateScene]);
	useEffect(() => {
		const element = host.current;
		if (!element) return;
		reportReady(false);
		let cleanup = () => {};
		let renderer: WebGLRenderer | undefined;
		let grid: GridHelper | undefined;
		let disposed = false;
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			cancel();
			runtime.current = null;
			cleanup();
			grid?.dispose();
			renderer?.dispose();
			renderer?.forceContextLoss();
			renderer?.domElement.remove();
		};
		try {
			renderer = new WebGLRenderer({
				antialias: true,
				alpha: true,
				stencil: true,
			});
			const output = renderer;
			const content = createSceneDisplay(sourceScene);
			const group = content.object;
			cleanup = () => content.dispose();
			const scene = new Scene();
			scene.add(group, new HemisphereLight("white", "#566173", 2.5));
			const light = new DirectionalLight("white", 3);
			light.position.set(1, -2, 3);
			scene.add(light);
			const canvas = output.domElement;
			canvas.tabIndex = 0;
			canvas.setAttribute(
				"aria-label",
				cameraMode === "top"
					? `${ariaLabel}. Top view locked. Drag or swipe to pan; pinch or Ctrl + scroll to zoom. Arrow keys pan, plus or minus zooms, and F6 fits the scene.`
					: `${ariaLabel}. Shift + left-drag to orbit and Ctrl + left-drag to pan. Two-finger swipe to pan, Shift + two-finger swipe to orbit, pinch or Ctrl + scroll to zoom toward the pointer. Middle-drag to pan and Shift + middle-drag to orbit with a mouse. Double-click the middle button or press F6 to fit. Arrow keys pan, plus or minus zooms. On touchscreens, drag to orbit and use two fingers to pan or pinch to zoom.`,
			);
			canvas.className =
				"block h-full w-full touch-none focus-visible:outline-2 focus-visible:outline-amber-200";
			element.append(canvas);
			const topView = cameraMode === "top";
			const camera = new PerspectiveCamera(40, 1, 0.01, 10000);
			camera.up.set(0, topView ? 1 : 0, topView ? 0 : 1);
			const navigation = create3DControls(camera, canvas, () => fit(), {
				lockTop: topView,
			});
			const { controls } = navigation;
			cleanup = () => {
				navigation.dispose();
				content.dispose();
			};
			// Include caller-supplied placement in camera fitting and clipping bounds.
			sceneUpdate.current?.(group);
			const bounds = new Box3().setFromObject(group);
			if (
				bounds.isEmpty() ||
				![...bounds.min.toArray(), ...bounds.max.toArray()].every(
					Number.isFinite,
				)
			)
				throw new Error("The scene has no finite geometry to display.");
			const sphere = bounds.getBoundingSphere(new Sphere());
			const radius = Math.max(sphere.radius, 0.001);
			grid = new GridHelper(radius * 6, 60, "#64748b", "#334155");
			grid.rotation.x = Math.PI / 2;
			grid.position.set(
				sphere.center.x,
				sphere.center.y,
				bounds.min.z - radius * 0.002,
			);
			grid.material.transparent = true;
			grid.material.opacity = 0.6;
			grid.material.depthWrite = false;
			if (cameraMode === "orbit") scene.add(grid);
			camera.near = radius / 1000;
			camera.far = radius * 1000;
			controls.minDistance = radius * 0.02;
			controls.maxDistance = radius * 100;
			let fittedDistance = 1;
			let ready = false;
			draw.current = () => {
				try {
					output.render(scene, camera);
					axes.current?.update(camera.quaternion);
					if (topView) {
						const width = Math.max(element.clientWidth, 1);
						const height = Math.max(element.clientHeight, 1);
						const distance = camera.position.distanceTo(controls.target);
						reportChange({
							backend: "WebGL 2 · Three.js",
							message: "",
							camera: {
								x: camera.position.x,
								y: camera.position.y,
								scale:
									height /
									(2 * distance * Math.tan((camera.fov * Math.PI) / 360)),
							},
							zoom: fittedDistance / distance,
							viewport: { width, height },
							highlighted: 0,
							diagnostics: {
								fps: 0,
								averageMs: 0,
								peakMs: 0,
								width: canvas.width,
								height: canvas.height,
								drawCalls: output.info.render.calls,
								triangles: output.info.render.triangles,
								geometries: output.info.memory.geometries,
								textures: output.info.memory.textures,
							},
						});
					}
					if (!ready) {
						ready = true;
						reportReady(true);
					}
				} catch (error) {
					cancel();
					reportReady(false);
					reportError(
						error instanceof Error
							? error.message
							: "Unable to draw this scene.",
					);
				}
			};
			const fit = () => {
				const halfFov = Math.atan(
					Math.tan((camera.fov * Math.PI) / 360) * Math.min(camera.aspect, 1),
				);
				const direction = camera.position
					.clone()
					.sub(controls.target)
					.normalize();
				if (topView) direction.set(0, 0, 1);
				else if (!direction.lengthSq()) direction.set(1, -1, 0.8).normalize();
				controls.target.copy(sphere.center);
				camera.position
					.copy(sphere.center)
					.addScaledVector(direction, (radius / Math.sin(halfFov)) * 1.3);
				fittedDistance = camera.position.distanceTo(controls.target);
				controls.update();
				schedule();
			};
			const zoom = (factor: number) => {
				if (!Number.isFinite(factor) || factor <= 0) return;
				const offset = camera.position.clone().sub(controls.target);
				const distance = Math.max(
					controls.minDistance,
					Math.min(controls.maxDistance, offset.length() / factor),
				);
				camera.position.copy(controls.target).add(offset.setLength(distance));
				controls.update();
				schedule();
			};
			const view = (direction: "iso" | "top" | "front") => {
				if (topView) direction = "top";
				camera.up.set(0, topView ? 1 : 0, topView ? 0 : 1);
				const offset =
					direction === "top"
						? new Vector3(0, 0, 1)
						: direction === "front"
							? new Vector3(0, -1, 0)
							: new Vector3(1, -1, 0.8);
				camera.position.copy(controls.target).add(offset);
				fit();
			};
			const resize = (width: number, height: number) => {
				output.setPixelRatio(viewerPixelRatio());
				output.setSize(width, height, false);
				camera.aspect = width / height;
				camera.updateProjectionMatrix();
				schedule();
			};
			const reset = fit;
			const pan = (x: number, y: number) => controls.pan(-x, -y);
			const onKey = (event: KeyboardEvent) =>
				handleViewerKeyDown(event, {
					fit: reset,
					zoom,
					fitOnF6: true,
				});
			const onLost = (event: Event) => {
				event.preventDefault();
				cancel();
				reportReady(false);
				reportError(
					"The 3D graphics context was lost. Reload the scene to restore the viewer.",
				);
			};
			canvas.addEventListener("keydown", onKey);
			canvas.addEventListener("webglcontextlost", onLost);
			controls.addEventListener("change", schedule);
			runtime.current = {
				fit: reset,
				pan,
				zoom,
				view,
				resize,
				update: (update) => {
					update(group);
					schedule();
				},
			};
			cleanup = () => {
				controls.removeEventListener("change", schedule);
				canvas.removeEventListener("keydown", onKey);
				canvas.removeEventListener("webglcontextlost", onLost);
				navigation.dispose();
				content.dispose();
			};
			resize(
				Math.max(element.clientWidth, 1),
				Math.max(element.clientHeight, 1),
			);
			view(topView ? "top" : "iso");
		} catch (error) {
			dispose();
			reportError(
				`3D viewer unavailable: ${error instanceof Error ? error.message : "WebGL is not supported in this browser."}`,
			);
		}
		return dispose;
	}, [sourceScene, cameraMode, ariaLabel, draw, schedule, cancel]);
	useEffect(() => {
		runtime.current?.resize(size.width, size.height);
	}, [size]);
	return (
		<>
			<div ref={host} className="absolute inset-0 overflow-hidden" />
			{cameraMode === "orbit" && <AxisIndicator ref={axes} />}
		</>
	);
}
