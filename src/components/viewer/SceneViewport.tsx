import {
	type ReactNode,
	type Ref,
	useEffect,
	useEffectEvent,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import {
	Box3,
	DirectionalLight,
	GridHelper,
	HemisphereLight,
	type Object3D,
	OrthographicCamera,
	PerspectiveCamera,
	Raycaster,
	Scene,
	Sphere,
	Vector2,
	Vector3,
	WebGLRenderer,
} from "three";
import { create3DControls } from "#/engine/controls3d.ts";
import {
	handleViewerKeyDown,
	MAX_ZOOM,
	MIN_ZOOM,
	viewerPixelRatio,
} from "#/engine/navigation.ts";
import { createSceneDisplay, type ViewerScene } from "#/engine/scene";
import {
	createSceneHover,
	type SceneHover,
	type SceneTarget,
} from "#/engine/scene-hover";
import { AxisIndicator } from "./AxisIndicator";
import type { AxisIndicatorHandle } from "./types/AxisIndicatorHandle";
import type { Viewer2DSnapshot } from "./types/Viewer2DSnapshot";
import type { Viewer3DHandle } from "./types/Viewer3DHandle";
import { useRenderFrame } from "./useRenderFrame";
import { useViewportSize } from "./useViewportSize";
import { ViewControls3D } from "./ViewControls3D";
import { ViewportRulers, type ViewportRulersHandle } from "./ViewportRulers";

export interface SceneViewportHandle extends Viewer3DHandle {
	pan: (x: number, y: number) => void;
}

export interface SceneViewportProps {
	scene: ViewerScene;
	cameraMode: "top" | "orbit";
	projection?: "perspective" | "orthographic";
	lockProjection?: boolean;
	selectionEnabled?: boolean;
	interactionHint?: string;
	onChange?: (snapshot: Viewer2DSnapshot) => void;
	/** Updates the existing object without replacing the scene or resetting the camera. */
	updateScene?: (object: Object3D) => void;
	ref?: Ref<SceneViewportHandle>;
	onReady?: (ready: boolean) => void;
	onError?: (message: string) => void;
	ariaLabel?: string;
	extraControls?: ReactNode;
}

export function SceneViewport({
	scene: sourceScene,
	cameraMode,
	projection = "perspective",
	lockProjection = false,
	selectionEnabled = true,
	interactionHint,
	onChange,
	updateScene,
	ref,
	onReady,
	onError,
	ariaLabel = "3D model",
	extraControls,
}: SceneViewportProps) {
	const [selectionInfo, setSelectionInfo] = useState<{
		name: string;
		kind: string;
		dimensions: string;
	} | null>(null);
	const [controlsReady, setControlsReady] = useState(false);
	const [zoomLevel, setZoomLevel] = useState(1);
	const [activeProjection, setActiveProjection] = useState(projection);
	useEffect(() => setActiveProjection(projection), [projection]);
	const host = useRef<HTMLDivElement>(null);
	const size = useViewportSize(host);
	const { draw, schedule, cancel } = useRenderFrame();
	const axes = useRef<AxisIndicatorHandle>(null);
	const rulers = useRef<ViewportRulersHandle>(null);
	const reportChange = useEffectEvent((snapshot: Viewer2DSnapshot) =>
		onChange?.(snapshot),
	);
	const reportReady = useEffectEvent((ready: boolean) => {
		setControlsReady(ready);
		onReady?.(ready);
	});
	const reportError = useEffectEvent((message: string) => onError?.(message));
	const runtime = useRef<
		| (SceneViewportHandle & {
				update: (update: (object: Object3D) => void) => void;
				resize: (width: number, height: number) => void;
				setProjection: (projection: "perspective" | "orthographic") => void;
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
	const currentProjection = useRef(activeProjection);
	useEffect(() => {
		currentProjection.current = activeProjection;
		runtime.current?.setProjection(activeProjection);
	}, [activeProjection]);
	const sceneUpdate = useRef(updateScene);
	useEffect(() => {
		sceneUpdate.current = updateScene;
		if (updateScene) runtime.current?.update(updateScene);
	}, [updateScene]);
	useEffect(() => {
		const element = host.current;
		if (!element) return;
		reportReady(false);
		setSelectionInfo(null);
		let cleanup = () => {};
		let renderer: WebGLRenderer | undefined;
		let grid: GridHelper | undefined;
		let hover: SceneHover | undefined;
		let selection: SceneHover | undefined;
		let disposed = false;
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			cancel();
			runtime.current = null;
			cleanup();
			hover?.dispose();
			selection?.dispose();
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
				interactionHint
					? `${ariaLabel}. ${interactionHint}`
					: cameraMode === "top"
						? `${ariaLabel}. Top view locked. Drag or swipe to pan; pinch or Ctrl + scroll to zoom. Arrow keys pan, plus or minus zooms, and F6 fits the scene.`
						: `${ariaLabel}. Shift + left-drag to orbit and Ctrl + left-drag to pan. Two-finger swipe to pan, Shift + two-finger swipe to orbit, pinch or Ctrl + scroll to zoom toward the pointer. Middle-drag to pan and Shift + middle-drag to orbit with a mouse. Double-click the middle button or press F6 to fit. Arrow keys pan, plus or minus zooms. On touchscreens, drag to orbit and use two fingers to pan or pinch to zoom.`,
			);
			canvas.className =
				"block h-full w-full touch-none focus-visible:outline-2 focus-visible:outline-amber-200";
			element.append(canvas);
			const topView = cameraMode === "top";
			const fieldOfView = topView ? 25 : 40;
			let camera: PerspectiveCamera | OrthographicCamera =
				currentProjection.current === "orthographic"
					? new OrthographicCamera(-1, 1, 1, -1, 0.01, 10000)
					: new PerspectiveCamera(fieldOfView, 1, 0.01, 10000);
			const halfFovTangent = Math.tan((fieldOfView * Math.PI) / 360);
			const visibleHeight = () =>
				camera instanceof OrthographicCamera
					? (camera.top - camera.bottom) / camera.zoom
					: 2 * camera.position.distanceTo(controls.target) * halfFovTangent;
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
			if (!topView) {
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
				grid.renderOrder = -1;
				scene.add(grid);
			}
			camera.near = radius / 1000;
			camera.far = radius * 1000;
			let fittedDistance = 1;
			let ready = false;
			let pointer: Vector2 | null = null;
			const raycaster = new Raycaster();
			hover = createSceneHover(content.entries);
			scene.add(hover.object);
			selection = createSceneHover(content.entries, "selection");
			scene.add(selection.object);
			let selected: SceneTarget | null = null;
			const clearSelection = () => {
				selected = null;
				setSelectionInfo(null);
				schedule();
			};
			draw.current = () => {
				try {
					camera.updateMatrixWorld();
					if (pointer) raycaster.setFromCamera(pointer, camera);
					const highlighted =
						hover?.update(
							pointer ? raycaster.ray : null,
							visibleHeight() / Math.max(element.clientHeight, 1),
						) ?? 0;
					if (selection?.update(null, 0, selected) === 0 && selected)
						clearSelection();
					content.update(output, camera);
					output.render(scene, camera);
					axes.current?.update(camera.quaternion);
					const currentZoom =
						fittedDistance / (visibleHeight() / (2 * halfFovTangent));
					setZoomLevel(
						Math.round(
							Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom)) * 1e6,
						) / 1e6,
					);
					if (topView) {
						const width = Math.max(element.clientWidth, 1);
						const height = Math.max(element.clientHeight, 1);
						rulers.current?.update({
							camera: {
								x: camera.position.x,
								y: camera.position.y,
								scale: height / visibleHeight(),
							},
							viewport: { width, height },
						});
						reportChange({
							backend: "WebGL 2 · Three.js",
							message: "",
							camera: {
								x: camera.position.x,
								y: camera.position.y,
								scale: height / visibleHeight(),
							},
							zoom: currentZoom,
							viewport: { width, height },
							highlighted,
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
					halfFovTangent *
						Math.min(
							Math.max(element.clientWidth, 1) /
								Math.max(element.clientHeight, 1),
							1,
						),
				);
				const direction = camera.position
					.clone()
					.sub(controls.target)
					.normalize();
				if (topView) direction.set(0, 0, 1);
				else if (!direction.lengthSq()) direction.set(1, -1, 0.8).normalize();
				controls.target.copy(sphere.center);
				// A flat editor sheet fits its rectangle, with room for rulers and controls.
				const viewportWidth = Math.max(element.clientWidth, 1);
				const viewportHeight = Math.max(element.clientHeight, 1);
				const sheetSize = bounds.getSize(new Vector3());
				const fitDistance =
					topView && lockProjection
						? Math.max(
								(sheetSize.y * viewportHeight) /
									Math.max(viewportHeight - 144, 1),
								(sheetSize.x * viewportHeight) /
									Math.max(viewportWidth - 144, 1),
							) /
							(2 * halfFovTangent)
						: (radius / Math.sin(halfFov)) * 1.3;
				camera.position
					.copy(sphere.center)
					.addScaledVector(direction, fitDistance);
				fittedDistance = camera.position.distanceTo(controls.target);
				controls.minDistance = fittedDistance / MAX_ZOOM;
				controls.maxDistance = fittedDistance / MIN_ZOOM;
				if (camera instanceof OrthographicCamera) {
					camera.zoom = 1;
					setOrthographicBounds(camera, 2 * fittedDistance * halfFovTangent);
				}
				controls.update();
				schedule();
			};
			const zoom = (factor: number) => {
				if (!Number.isFinite(factor) || factor <= 0) return;
				if (camera instanceof OrthographicCamera) {
					camera.zoom = Math.max(
						controls.minZoom,
						Math.min(controls.maxZoom, camera.zoom * factor),
					);
					camera.updateProjectionMatrix();
					controls.update();
					schedule();
					return;
				}
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
			const setOrthographicBounds = (
				orthographic: OrthographicCamera,
				height: number,
			) => {
				const aspect =
					Math.max(element.clientWidth, 1) / Math.max(element.clientHeight, 1);
				orthographic.top = height / 2;
				orthographic.bottom = -height / 2;
				orthographic.left = (-height * aspect) / 2;
				orthographic.right = (height * aspect) / 2;
				orthographic.updateProjectionMatrix();
				controls.minZoom = height / (2 * controls.maxDistance * halfFovTangent);
				controls.maxZoom = height / (2 * controls.minDistance * halfFovTangent);
			};
			const setProjection = (projection: "perspective" | "orthographic") => {
				if (
					camera instanceof OrthographicCamera ===
					(projection === "orthographic")
				)
					return;
				const height = visibleHeight();
				const next =
					projection === "orthographic"
						? new OrthographicCamera(-1, 1, 1, -1, camera.near, camera.far)
						: new PerspectiveCamera(
								fieldOfView,
								Math.max(element.clientWidth, 1) /
									Math.max(element.clientHeight, 1),
								camera.near,
								camera.far,
							);
				next.position.copy(camera.position);
				next.quaternion.copy(camera.quaternion);
				next.up.copy(camera.up);
				if (next instanceof OrthographicCamera) {
					setOrthographicBounds(next, height);
				} else {
					next.position.copy(controls.target).add(
						camera.position
							.clone()
							.sub(controls.target)
							.setLength(height / (2 * halfFovTangent)),
					);
				}
				camera = next;
				controls.object = next;
				controls.update();
				schedule();
			};
			const resize = (width: number, height: number) => {
				output.setPixelRatio(viewerPixelRatio());
				output.setSize(width, height, false);
				if (camera instanceof OrthographicCamera) {
					setOrthographicBounds(camera, camera.top - camera.bottom);
				} else camera.aspect = width / height;
				camera.updateProjectionMatrix();
				schedule();
			};
			const reset = fit;
			const pan = (x: number, y: number) => controls.pan(-x, -y);
			const onKey = (event: KeyboardEvent) => {
				if (event.key === "Escape") clearSelection();
				handleViewerKeyDown(event, {
					fit: reset,
					zoom,
					fitOnF6: true,
				});
			};
			const onLost = (event: Event) => {
				event.preventDefault();
				cancel();
				reportReady(false);
				reportError(
					"The 3D graphics context was lost. Reload the scene to restore the viewer.",
				);
			};
			const clearHover = () => {
				pointer = null;
				schedule();
			};
			let press: { id: number; x: number; y: number } | null = null;
			const cancelPress = () => {
				press = null;
				clearHover();
			};
			const startPress = (event: PointerEvent) => {
				press =
					!press &&
					event.isPrimary &&
					event.button === 0 &&
					!event.shiftKey &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.metaKey
						? { id: event.pointerId, x: event.clientX, y: event.clientY }
						: null;
				clearHover();
			};
			const endPress = (event: PointerEvent) => {
				const start = press;
				press = null;
				if (
					!start ||
					start.id !== event.pointerId ||
					Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4
				)
					return;
				const rect = canvas.getBoundingClientRect();
				pointer = new Vector2(
					((event.clientX - rect.left) / rect.width) * 2 - 1,
					1 - ((event.clientY - rect.top) / rect.height) * 2,
				);
				camera.updateMatrixWorld();
				raycaster.setFromCamera(pointer, camera);
				hover?.update(
					raycaster.ray,
					visibleHeight() / Math.max(element.clientHeight, 1),
				);
				selected = hover?.getTarget() ?? null;
				if (selected) {
					const box = new Box3();
					const planar = selected.entry.planar;
					if (planar && selected.region !== undefined) {
						for (const region of planar.regions.filter(
							(region) => region.component === selected?.region,
						)) {
							box.expandByPoint(
								new Vector3(region.bounds.minX, region.bounds.minY, 0),
							);
							box.expandByPoint(
								new Vector3(region.bounds.maxX, region.bounds.maxY, 0),
							);
						}
						box.applyMatrix4(selected.entry.object.matrixWorld);
					} else box.setFromObject(selected.mesh);
					const dimensions = box.getSize(new Vector3());
					setSelectionInfo({
						name:
							selected.mesh.name ||
							selected.entry.object.name ||
							"Unnamed component",
						kind:
							planar && selected.region !== undefined
								? `Connected shape ${selected.region + 1}`
								: "3D part",
						dimensions: `${(planar
							? [dimensions.x, dimensions.y]
							: dimensions.toArray()
						)
							.map((value) => value.toFixed(2))
							.join(" × ")} mm`,
					});
				} else setSelectionInfo(null);
				schedule();
			};
			const moveHover = (event: PointerEvent) => {
				if (
					press &&
					Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4
				)
					press = null;
				if (event.buttons || event.pointerType === "touch") {
					clearHover();
					return;
				}
				const rect = canvas.getBoundingClientRect();
				pointer = new Vector2(
					((event.clientX - rect.left) / rect.width) * 2 - 1,
					1 - ((event.clientY - rect.top) / rect.height) * 2,
				);
				schedule();
			};
			if (hover && selectionEnabled) {
				canvas.addEventListener("pointermove", moveHover);
				canvas.addEventListener("pointerleave", clearHover);
				canvas.addEventListener("pointerdown", startPress);
				canvas.addEventListener("pointerup", endPress);
				canvas.addEventListener("pointercancel", cancelPress);
				window.addEventListener("blur", cancelPress);
			}
			canvas.addEventListener("keydown", onKey);
			canvas.addEventListener("webglcontextlost", onLost);
			controls.addEventListener("change", schedule);
			runtime.current = {
				fit: reset,
				pan,
				zoom,
				view,
				resize,
				setProjection,
				update: (update) => {
					update(group);
					schedule();
				},
			};
			cleanup = () => {
				canvas.removeEventListener("pointermove", moveHover);
				canvas.removeEventListener("pointerleave", clearHover);
				canvas.removeEventListener("pointerdown", startPress);
				canvas.removeEventListener("pointerup", endPress);
				canvas.removeEventListener("pointercancel", cancelPress);
				window.removeEventListener("blur", cancelPress);
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
			setProjection(currentProjection.current);
		} catch (error) {
			dispose();
			reportError(
				`3D viewer unavailable: ${error instanceof Error ? error.message : "WebGL is not supported in this browser."}`,
			);
		}
		return dispose;
	}, [
		sourceScene,
		cameraMode,
		ariaLabel,
		interactionHint,
		selectionEnabled,
		lockProjection,
		draw,
		schedule,
		cancel,
	]);
	useEffect(() => {
		runtime.current?.resize(size.width, size.height);
	}, [size]);
	return (
		<>
			<div
				ref={host}
				className="viewport-canvas absolute inset-0 overflow-hidden"
			/>
			{selectionInfo && (
				<div
					role="tooltip"
					aria-label="Selected component"
					className="pointer-events-none absolute bottom-20 left-4 z-20 max-w-[calc(100%-2rem)] rounded-lg border border-white/20 bg-slate-950/95 px-4 py-3 text-sm text-slate-100 shadow-lg"
				>
					<p className="break-words font-semibold">{selectionInfo.name}</p>
					<p className="text-slate-300">{selectionInfo.kind}</p>
					<p>Dimensions: {selectionInfo.dimensions}</p>
					<p className="mt-1 text-xs text-slate-400">
						Click empty space or press Escape to clear
					</p>
				</div>
			)}
			{cameraMode === "top" && <ViewportRulers ref={rulers} />}
			{cameraMode === "orbit" && <AxisIndicator ref={axes} />}
			{controlsReady && (
				<ViewControls3D
					enabled={controlsReady}
					zoomLevel={zoomLevel}
					projection={activeProjection}
					toggleProjection={
						lockProjection
							? undefined
							: () =>
									setActiveProjection((current) =>
										current === "perspective" ? "orthographic" : "perspective",
									)
					}
					fit={() => runtime.current?.fit()}
					zoom={(factor) => runtime.current?.zoom(factor)}
					view={
						cameraMode === "orbit"
							? (direction) => runtime.current?.view(direction)
							: undefined
					}
					fitLabel={cameraMode === "top" ? "Fit drawing" : "Fit model"}
				>
					{extraControls}
				</ViewControls3D>
			)}
		</>
	);
}
