import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import {
	Box3,
	DirectionalLight,
	GridHelper,
	HemisphereLight,
	Mesh,
	PerspectiveCamera,
	Scene,
	Sphere,
	Vector3,
	WebGLRenderer,
} from "three";
import { handleViewerKeyDown, viewerPixelRatio } from "#/engine/navigation.ts";
import { createFusionControls } from "#/engine/step/fusionControls.ts";
import { createStepGroup, disposeStepGroup } from "#/engine/step/model.ts";
import type { StepModel } from "#/formats/step/types/StepModel.ts";
import { useRenderFrame } from "../viewer/useRenderFrame";
import { useViewportSize } from "../viewer/useViewportSize";
import { AxisIndicator } from "./AxisIndicator";
import type { AxisIndicatorHandle } from "./types/AxisIndicatorHandle";
import type { StepViewerHandle } from "./types/StepViewerHandle";

export function StepViewer({
	model,
	hidden,
	wireframe,
	ref,
	onReady,
	onError,
}: {
	model: StepModel;
	hidden: Set<number>;
	wireframe: boolean;
	ref?: Ref<StepViewerHandle>;
	onReady: (ready: boolean) => void;
	onError: (message: string) => void;
}) {
	const host = useRef<HTMLDivElement>(null);
	const size = useViewportSize(host);
	const { draw, schedule, cancel } = useRenderFrame();
	const axes = useRef<AxisIndicatorHandle>(null);
	const runtime = useRef<
		| (StepViewerHandle & {
				update: (hidden: Set<number>, wireframe: boolean) => void;
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
		}),
		[],
	);
	useEffect(() => {
		const element = host.current;
		if (!element) return;
		onReady(false);
		let cleanup = () => {};
		let renderer: WebGLRenderer | undefined;
		let grid: GridHelper | undefined;
		try {
			renderer = new WebGLRenderer({ antialias: true, alpha: true });
			const output = renderer;
			const group = createStepGroup(model);
			cleanup = () => disposeStepGroup(group);
			const scene = new Scene();
			scene.add(group, new HemisphereLight("white", "#566173", 2.5));
			const light = new DirectionalLight("white", 3);
			light.position.set(1, -2, 3);
			scene.add(light);
			const camera = new PerspectiveCamera(40, 1, 0.01, 10000);
			camera.up.set(0, 0, 1);
			const canvas = output.domElement;
			canvas.tabIndex = 0;
			canvas.setAttribute(
				"aria-label",
				"3D STEP model. Shift + left-drag to orbit and Ctrl + left-drag to pan. Two-finger swipe to pan, Shift + two-finger swipe to orbit, pinch or Ctrl + scroll to zoom toward the pointer. Middle-drag to pan and Shift + middle-drag to orbit with a mouse. Double-click the middle button or press F6 to fit. Arrow keys pan, plus or minus zooms. On touchscreens, drag to orbit and use two fingers to pan or pinch to zoom.",
			);
			canvas.className =
				"block h-full w-full touch-none focus-visible:outline-2 focus-visible:outline-amber-200";
			element.append(canvas);
			const navigation = createFusionControls(camera, canvas, () => fit());
			const { controls } = navigation;
			const bounds = new Box3().setFromObject(group);
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
			scene.add(grid);
			camera.near = radius / 1000;
			camera.far = radius * 1000;
			controls.minDistance = radius * 0.02;
			controls.maxDistance = radius * 100;
			let ready = false;
			draw.current = () => {
				try {
					output.render(scene, camera);
					axes.current?.update(camera.quaternion);
					if (!ready) {
						ready = true;
						onReady(true);
					}
				} catch (error) {
					cancel();
					onReady(false);
					onError(
						error instanceof Error
							? error.message
							: "Unable to draw this file.",
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
				if (!direction.lengthSq()) direction.set(1, -1, 0.8).normalize();
				controls.target.copy(sphere.center);
				camera.position
					.copy(sphere.center)
					.addScaledVector(direction, (radius / Math.sin(halfFov)) * 1.3);
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
				camera.up.set(0, 0, 1);
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
			const onKey = (event: KeyboardEvent) =>
				handleViewerKeyDown(event, { fit, zoom, fitOnF6: true });
			const onLost = (event: Event) => {
				event.preventDefault();
				cancel();
				onReady(false);
				onError(
					"The 3D graphics context was lost. Reopen the file to restore the viewer.",
				);
			};
			canvas.addEventListener("keydown", onKey);
			canvas.addEventListener("webglcontextlost", onLost);
			controls.addEventListener("change", schedule);
			runtime.current = {
				fit,
				zoom,
				view,
				resize,
				update: (hiddenParts, showWireframe) => {
					group.children.forEach((object, index) => {
						object.visible = !hiddenParts.has(index);
						if (object instanceof Mesh)
							for (const material of object.material)
								material.wireframe = showWireframe;
					});
					schedule();
				},
			};
			cleanup = () => {
				controls.removeEventListener("change", schedule);
				canvas.removeEventListener("keydown", onKey);
				canvas.removeEventListener("webglcontextlost", onLost);
				navigation.dispose();
				disposeStepGroup(group);
			};
			resize(
				Math.max(element.clientWidth, 1),
				Math.max(element.clientHeight, 1),
			);
			view("iso");
		} catch (error) {
			onError(
				`3D viewer unavailable: ${error instanceof Error ? error.message : "WebGL is not supported in this browser."}`,
			);
		}
		return () => {
			cancel();
			runtime.current = null;
			cleanup();
			grid?.dispose();
			renderer?.dispose();
			renderer?.forceContextLoss();
			renderer?.domElement.remove();
		};
	}, [model, onReady, onError, draw, schedule, cancel]);
	useEffect(() => {
		runtime.current?.resize(size.width, size.height);
	}, [size]);
	useEffect(() => {
		if (model.meshes.length) runtime.current?.update(hidden, wireframe);
	}, [model, hidden, wireframe]);
	return (
		<>
			<div ref={host} className="absolute inset-0 overflow-hidden" />
			<AxisIndicator ref={axes} />
		</>
	);
}
