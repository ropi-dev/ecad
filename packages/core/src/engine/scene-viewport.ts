import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	Box3,
	DirectionalLight,
	GridHelper,
	HemisphereLight,
	type Object3D,
	OrthographicCamera,
	PerspectiveCamera,
	type Quaternion,
	Raycaster,
	Scene,
	Sphere,
	Vector2,
	Vector3,
	WebGLRenderer,
} from "three";
import { viewerTheme } from "#/drawing/schematic-theme.ts";
import { getSceneBounds } from "#/engine/camera.ts";
import { capturePng } from "#/engine/capture-png.ts";
import { create3DControls } from "#/engine/controls3d.ts";
import { createDrawBatcher } from "#/engine/draw-batch.ts";
import {
	handleViewerKeyDown,
	MAX_ZOOM,
	MIN_ZOOM,
	viewerPixelRatio,
} from "#/engine/navigation.ts";
import { createPanCache } from "#/engine/pan-cache.ts";
import { createSceneDisplay, type ViewerScene } from "#/engine/scene.ts";
import { createSceneHover, type SceneTarget } from "#/engine/scene-hover.ts";
import type { Bounds, Camera } from "#/engine/types.ts";
import {
	createViewportGrid,
	type ViewportGridOptions,
} from "#/engine/viewport-grid.ts";
import type {
	Viewer2DSnapshot,
	Viewer3DHandle,
} from "#/engine/viewport-types.ts";
import { createLifecycle } from "#/lib/lifecycle.ts";
import { getAppPerformance } from "#/performance/runtime.ts";

export const MIN_PHYSICAL_ZOOM = 0.01;
export const MAX_PHYSICAL_ZOOM = 100;

export interface SceneSelection {
	name: string;
	region?: number;
	dimensions: readonly number[];
}

export interface SceneViewportOptions {
	scene: ViewerScene;
	cameraMode: "top" | "orbit";
	projection: "perspective" | "orthographic";
	lockProjection?: boolean;
	fitZoom?: number;
	initialCamera?: Camera;
	getFitBounds?: () => Bounds | null;
	selectionEnabled?: boolean;
	antialias?: boolean;
	ariaLabel?: string;
	canvasClassName?: string;
	updateScene?: (object: Object3D) => void;
	onChange?: (snapshot: Viewer2DSnapshot) => void;
	onSelection?: (selection: SceneSelection | null) => void;
	onOrientation?: (rotation: Quaternion) => void;
	onZoom?: (zoom: number) => void;
	onReady?: (ready: boolean) => void;
	onError?: (message: string) => void;
}

export interface SceneViewportRuntime extends Viewer3DHandle {
	pan: (x: number, y: number) => void;
	capture: () => Promise<Blob>;
	update: (update: (object: Object3D) => void) => void;
	resize: (width: number, height: number) => void;
	setPhysicalScale: (scale: number | null) => void;
	/** Shows a dot grid under a top view, or hides it with null. */
	setGrid: (grid: ViewportGridOptions | null) => void;
	actualSize: () => void;
	setProjection: (projection: "perspective" | "orthographic") => void;
	dispose: () => void;
}

/** Owns the renderer, scene resources and input listeners for one mounted viewport. */
export function createSceneViewport(
	element: HTMLElement,
	{
		scene: sourceScene,
		cameraMode,
		projection,
		lockProjection = false,
		fitZoom = 1,
		initialCamera,
		getFitBounds,
		selectionEnabled = true,
		antialias = true,
		ariaLabel = "3D model",
		canvasClassName = "",
		updateScene,
		onChange,
		onSelection,
		onOrientation,
		onZoom,
		onReady,
		onError,
	}: SceneViewportOptions,
): SceneViewportRuntime {
	const lifecycle = createLifecycle();
	let disposed = false;
	let frame: number | null = null;
	let draw = () => {};
	// Set when anything but the camera changed since the last full render.
	let sceneChanged = true;
	const requestFrame = () => {
		if (disposed || frame !== null) return;
		frame = requestAnimationFrame(() => {
			frame = null;
			draw();
		});
	};
	const schedule = () => {
		sceneChanged = true;
		requestFrame();
	};
	let drawingChanged = false;
	const scheduleDrawing = () => {
		drawingChanged = true;
		requestFrame();
	};
	const cancel = () => {
		if (frame !== null) cancelAnimationFrame(frame);
		frame = null;
		draw = () => {};
	};
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		cancel();
		lifecycle.dispose();
	};
	try {
		const output = lifecycle.acquire(
			() => new WebGLRenderer({ antialias, alpha: true, stencil: true }),
			(renderer) => {
				try {
					renderer.dispose();
				} finally {
					try {
						renderer.forceContextLoss();
					} finally {
						renderer.domElement.remove();
					}
				}
			},
		);
		const content = lifecycle.acquire(
			() => createSceneDisplay(sourceScene),
			(display) => display.dispose(),
		);
		const group = content.object;
		// Only a locked top view pans without changing scale or orientation.
		const panCache =
			cameraMode === "top" && !content.hasOutlines
				? lifecycle.acquire(
						() => createPanCache(output),
						(cache) => cache.dispose(),
					)
				: null;
		const batcher =
			cameraMode === "top" && !content.hasOutlines && !selectionEnabled
				? lifecycle.acquire(createDrawBatcher, (batcher) => batcher.dispose())
				: null;
		if (batcher) {
			group.matrixAutoUpdate = false;
			output.setTransparentSort(
				(a, b) =>
					a.groupOrder - b.groupOrder ||
					a.renderOrder - b.renderOrder ||
					b.z - a.z,
			);
		}
		let batched = false;
		const syncBatches = () => {
			if (!batcher) return null;
			const result = batcher.sync(group, output);
			batched = result.batched;
			group.visible = !batched;
			group.matrixWorldAutoUpdate = !batched;
			return result.damage;
		};
		const scene = new Scene();
		scene.add(
			group,
			new HemisphereLight("white", viewerTheme.ambientGround, 2.5),
		);
		if (batcher) scene.add(batcher.object);
		/**
		 * Draws the whole view. Three recomputes every world matrix under the
		 * scene on each render. Batches hold world positions, and the batcher
		 * keeps the hidden meshes' matrices current, so a batched view updates
		 * only the scene's other children.
		 */
		const renderScene = () => {
			if (!batched) {
				output.render(scene, camera);
				return;
			}
			for (const child of scene.children)
				if (child !== group) child.updateMatrixWorld();
			scene.matrixWorldAutoUpdate = false;
			try {
				output.render(scene, camera);
			} finally {
				scene.matrixWorldAutoUpdate = true;
			}
		};
		const light = new DirectionalLight("white", 3);
		light.position.set(1, -2, 3);
		scene.add(light);
		const grid =
			cameraMode === "top"
				? lifecycle.acquire(createViewportGrid, (grid) => grid.dispose())
				: null;
		if (grid) scene.add(grid.object);
		const canvas = output.domElement;
		canvas.tabIndex = 0;
		canvas.setAttribute("aria-label", ariaLabel);
		canvas.className = canvasClassName;
		element.append(canvas);
		const topView = cameraMode === "top";
		const fieldOfView = topView ? 25 : 40;
		let camera: PerspectiveCamera | OrthographicCamera =
			projection === "orthographic"
				? new OrthographicCamera(-1, 1, 1, -1, 0.01, 10000)
				: new PerspectiveCamera(fieldOfView, 1, 0.01, 10000);
		const halfFovTangent = Math.tan((fieldOfView * Math.PI) / 360);
		const visibleHeight = () =>
			camera instanceof OrthographicCamera
				? (camera.top - camera.bottom) / camera.zoom
				: 2 * camera.position.distanceTo(controls.target) * halfFovTangent;
		camera.up.set(0, topView ? 1 : 0, topView ? 0 : 1);
		const navigation = lifecycle.acquire(
			() => create3DControls(camera, canvas, () => fit(), { lockTop: topView }),
			(navigation) => navigation.dispose(),
		);
		const { controls } = navigation;
		// Include caller-supplied placement in camera fitting and clipping bounds.
		updateScene?.(group);
		const bounds = new Box3().setFromObject(group);
		if (topView && sourceScene.length === 0 && bounds.isEmpty()) {
			// An unopened drawing still provides a navigable grid centered at the origin.
			const empty = getSceneBounds([]);
			bounds.set(
				new Vector3(empty.minX, empty.minY, 0),
				new Vector3(empty.maxX, empty.maxY, 0),
			);
		}
		if (
			bounds.isEmpty() ||
			![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
		)
			throw new Error("The scene has no finite geometry to display.");
		const sphere = bounds.getBoundingSphere(new Sphere());
		const radius = Math.max(sphere.radius, 0.001);
		if (!topView) {
			const grid = lifecycle.acquire(
				() =>
					new GridHelper(
						radius * 6,
						60,
						viewerTheme.gridMajor,
						viewerTheme.gridMinor,
					),
				(grid) => grid.dispose(),
			);
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
		let zoomReferenceDistance = 0;
		let physicalScale: number | null = null;
		let viewportHeight = Math.max(element.clientHeight, 1);
		const referenceDistance = () =>
			physicalScale === null
				? zoomReferenceDistance
				: viewportHeight / (2 * halfFovTangent * physicalScale);
		const updateZoomLimits = (activeCamera = camera) => {
			controls.minDistance =
				referenceDistance() /
				(physicalScale === null ? MAX_ZOOM : MAX_PHYSICAL_ZOOM);
			controls.maxDistance =
				referenceDistance() /
				(physicalScale === null ? MIN_ZOOM : MIN_PHYSICAL_ZOOM);
			if (activeCamera instanceof OrthographicCamera) {
				const height = activeCamera.top - activeCamera.bottom;
				controls.minZoom = height / (2 * controls.maxDistance * halfFovTangent);
				controls.maxZoom = height / (2 * controls.minDistance * halfFovTangent);
			}
		};
		let ready = false;
		let pointer: Vector2 | null = null;
		const raycaster = new Raycaster();
		const hover = lifecycle.acquire(
			() => createSceneHover(content.entries),
			(hover) => hover.dispose(),
		);
		scene.add(hover.object);
		const selection = lifecycle.acquire(
			() => createSceneHover(content.entries, "selection"),
			(selection) => selection.dispose(),
		);
		scene.add(selection.object);
		let selected: SceneTarget | null = null;
		let highlighted = 0;
		// A pan shows the camera at a whole pixel offset. Until the camera
		// moves again, full renders keep that position, so the picture and
		// overlays don't shift by a fraction of a pixel.
		let held: {
			x: number;
			y: number;
			zoom: number;
			shown: { x: number; y: number };
		} | null = null;
		const clearSelection = () => {
			selected = null;
			onSelection?.(null);
			schedule();
		};
		const placeGrid = (position: { x: number; y: number }) => {
			if (!grid) return;
			// A top view maps the drawing plane linearly in either projection.
			const height = visibleHeight();
			const width =
				camera instanceof OrthographicCamera
					? (camera.right - camera.left) / camera.zoom
					: height * camera.aspect;
			grid.update({
				position,
				width: canvas.width,
				height: canvas.height,
				scaleX: canvas.width / width,
				scaleY: canvas.height / height,
				ratio: output.getPixelRatio(),
				rulerScale: Math.max(element.clientHeight, 1) / height,
			});
		};
		draw = () => {
			const recorder = getAppPerformance();
			const started = recorder ? performance.now() : 0;
			const changed = sceneChanged;
			sceneChanged = false;
			const edited = drawingChanged;
			drawingChanged = false;
			let shown: { x: number; y: number } | null = null;
			let panCacheHit = false;
			try {
				camera.updateMatrixWorld();
				const damage = changed || edited ? syncBatches() : null;
				// Hover depends on the pointer, so only a scene without one pans.
				const panned =
					panCache &&
					!changed &&
					(!edited || (batched && damage)) &&
					!pointer &&
					camera instanceof OrthographicCamera
						? panCache.pan(scene, camera, placeGrid, damage ?? undefined)
						: null;
				const { x, y } = camera.position;
				panCacheHit = panned !== null;
				if (panned) {
					shown = panned;
					held = { x, y, zoom: camera.zoom, shown: panned };
				} else {
					if (held?.x !== x || held.y !== y || held.zoom !== camera.zoom)
						held = null;
					shown = held?.shown ?? null;
					if (pointer) raycaster.setFromCamera(pointer, camera);
					highlighted =
						hover?.update(
							pointer ? raycaster.ray : null,
							visibleHeight() / Math.max(element.clientHeight, 1),
						) ?? 0;
					if (selection?.update(null, 0, selected) === 0 && selected)
						clearSelection();
					if (shown) {
						camera.position.setX(shown.x).setY(shown.y);
						camera.updateMatrixWorld();
					}
					try {
						content.update(output, camera);
						placeGrid(camera.position);
						if (batched)
							batcher?.prepare(visibleHeight() / Math.max(canvas.height, 1));
						renderScene();
						if (camera instanceof OrthographicCamera) panCache?.capture(camera);
						else panCache?.invalidate();
					} finally {
						if (shown) {
							camera.position.setX(x).setY(y);
							camera.updateMatrixWorld();
						}
					}
				}
				onOrientation?.(camera.quaternion);
				const currentZoom =
					referenceDistance() / (visibleHeight() / (2 * halfFovTangent));
				onZoom?.(
					Math.round(
						(physicalScale === null
							? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom))
							: currentZoom) * 1e6,
					) / 1e6,
				);
				if (topView) {
					const width = Math.max(element.clientWidth, 1);
					const height = Math.max(element.clientHeight, 1);
					onChange?.({
						backend: "WebGL 2 · Three.js",
						message: "",
						camera: {
							x: shown?.x ?? camera.position.x,
							y: shown?.y ?? camera.position.y,
							scale: height / visibleHeight(),
						},
						zoom: currentZoom,
						viewport: { width, height },
						highlighted,
						diagnostics: {
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
					onReady?.(true);
				}
			} catch (error) {
				panCache?.invalidate();
				group.visible = true;
				group.matrixWorldAutoUpdate = true;
				batched = false;
				if (batcher) batcher.object.visible = false;
				cancel();
				onReady?.(false);
				onError?.(errorMessage(error, "Unable to draw this scene."));
			} finally {
				recorder?.record(
					"renderer.frame",
					performance.now() - started,
					{
						panned: panCacheHit,
						calls: output.info.render.calls,
						triangles: output.info.render.triangles,
						geometries: output.info.memory.geometries,
						textures: output.info.memory.textures,
					},
					started,
				);
			}
		};
		const selectionBounds = (target: SceneTarget) => {
			const box = new Box3();
			const planar = target.entry.planar;
			if (planar && target.region !== undefined) {
				for (const region of planar.regions.filter(
					(region) => region.component === target.region,
				)) {
					box.expandByPoint(
						new Vector3(region.bounds.minX, region.bounds.minY, 0),
					);
					box.expandByPoint(
						new Vector3(region.bounds.maxX, region.bounds.maxY, 0),
					);
				}
				box.applyMatrix4(target.entry.object.matrixWorld);
			} else box.setFromObject(target.mesh);
			return box;
		};
		const fit = () => {
			const customBounds = getFitBounds?.();
			const selectedBounds = customBounds
				? new Box3(
						new Vector3(customBounds.minX, customBounds.minY, 0),
						new Vector3(customBounds.maxX, customBounds.maxY, 0),
					)
				: selected
					? selectionBounds(selected)
					: null;
			const fitBounds =
				selectedBounds && !selectedBounds.isEmpty() ? selectedBounds : bounds;
			const selectionDistanceScale = fitBounds === selectedBounds ? 2 : 1;
			const fitSphere = fitBounds.getBoundingSphere(new Sphere());
			const fitRadius = Math.max(fitSphere.radius, 0.001);
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
			controls.target.copy(fitSphere.center);
			// A flat editor sheet fits its rectangle, with room for rulers and controls.
			const viewportWidth = Math.max(element.clientWidth, 1);
			const viewportHeight = Math.max(element.clientHeight, 1);
			const sheetSize = fitBounds.getSize(new Vector3());
			const fitDistance =
				topView && lockProjection
					? Math.max(
							(Math.max(sheetSize.y, 0.001) * viewportHeight) /
								Math.max(viewportHeight - 144, 1),
							(Math.max(sheetSize.x, 0.001) * viewportHeight) /
								Math.max(viewportWidth - 144, 1),
						) /
						(2 * halfFovTangent)
					: (fitRadius / Math.sin(halfFov)) * 1.3;
			camera.position
				.copy(fitSphere.center)
				.addScaledVector(
					direction,
					(fitDistance * selectionDistanceScale) /
						(Number.isFinite(fitZoom) && fitZoom > 0 ? fitZoom : 1),
				);
			const distance = camera.position.distanceTo(controls.target);
			if (zoomReferenceDistance === 0) zoomReferenceDistance = distance;
			updateZoomLimits();
			if (camera instanceof OrthographicCamera) {
				camera.zoom = 1;
				setOrthographicBounds(camera, 2 * distance * halfFovTangent);
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
			updateZoomLimits(orthographic);
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
			const resizedHeight =
				camera instanceof OrthographicCamera && physicalScale !== null
					? ((camera.top - camera.bottom) * height) / viewportHeight
					: null;
			viewportHeight = height;
			output.setPixelRatio(viewerPixelRatio());
			output.setSize(width, height, false);
			if (camera instanceof OrthographicCamera) {
				setOrthographicBounds(
					camera,
					resizedHeight ?? camera.top - camera.bottom,
				);
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
			onReady?.(false);
			onError?.(
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
				const box = selectionBounds(selected);
				const planar = selected.entry.planar;
				const dimensions = box.getSize(new Vector3());
				onSelection?.({
					name: selected.mesh.name || selected.entry.object.name,
					region: planar ? selected.region : undefined,
					dimensions: planar
						? [dimensions.x, dimensions.y]
						: dimensions.toArray(),
				});
			} else onSelection?.(null);
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
			lifecycle.listen(canvas, "pointermove", moveHover);
			lifecycle.listen(canvas, "pointerleave", clearHover);
			lifecycle.listen(canvas, "pointerdown", startPress);
			lifecycle.listen(canvas, "pointerup", endPress);
			lifecycle.listen(canvas, "pointercancel", cancelPress);
			lifecycle.listen(window, "blur", cancelPress);
		}
		lifecycle.listen(canvas, "keydown", onKey);
		lifecycle.listen(canvas, "webglcontextlost", onLost);
		// Camera moves alone can reuse the last frame.
		controls.addEventListener("change", requestFrame);
		lifecycle.addFinalizer(() =>
			controls.removeEventListener("change", requestFrame),
		);
		const runtime: SceneViewportRuntime = {
			dispose,
			fit: reset,
			pan,
			zoom,
			view,
			resize,
			setProjection,
			setPhysicalScale: (scale) => {
				const next =
					topView &&
					lockProjection &&
					scale !== null &&
					Number.isFinite(scale) &&
					scale > 0
						? scale
						: null;
				if (next === physicalScale) return;
				const previous = physicalScale;
				physicalScale = next;
				updateZoomLimits();
				if (next !== null && previous !== null) zoom(next / previous);
				schedule();
			},
			setGrid: (options) => {
				grid?.set(options);
				schedule();
			},
			actualSize: () => {
				if (physicalScale !== null)
					zoom((physicalScale * visibleHeight()) / viewportHeight);
			},
			capture: () => {
				if (output.getContext().isContextLost())
					throw new Error("The graphics context is unavailable.");
				// Render and copy in the same task; preserveDrawingBuffer stays disabled.
				camera.updateMatrixWorld();
				content.update(output, camera);
				syncBatches();
				if (batched)
					batcher?.prepare(visibleHeight() / Math.max(canvas.height, 1));
				// The grid is a view aid, not part of the exported picture.
				const gridVisible = grid?.object.visible ?? false;
				if (grid) grid.object.visible = false;
				try {
					renderScene();
				} finally {
					if (grid) grid.object.visible = gridVisible;
				}
				// The canvas now lacks the grid, so the next frame redraws it.
				schedule();
				return capturePng(canvas);
			},
			update: (update) => {
				update(group);
				if (batcher) scheduleDrawing();
				else schedule();
			},
		};
		resize(Math.max(element.clientWidth, 1), Math.max(element.clientHeight, 1));
		view(topView ? "top" : "iso");
		setProjection(projection);
		// Start compiling view aid shaders before the first frame needs them.
		grid?.prepare(output, camera, scene);
		panCache?.prepare();
		if (topView && camera instanceof OrthographicCamera && initialCamera) {
			const offset = camera.position.z - controls.target.z;
			controls.target.set(initialCamera.x, initialCamera.y, controls.target.z);
			camera.position.set(
				initialCamera.x,
				initialCamera.y,
				controls.target.z + offset,
			);
			camera.zoom = 1;
			setOrthographicBounds(
				camera,
				Math.max(element.clientHeight, 1) / initialCamera.scale,
			);
			schedule();
		} else if (topView && initialCamera) {
			const distance =
				Math.max(element.clientHeight, 1) /
				initialCamera.scale /
				(2 * halfFovTangent);
			controls.target.set(initialCamera.x, initialCamera.y, controls.target.z);
			camera.position.set(
				initialCamera.x,
				initialCamera.y,
				controls.target.z + distance,
			);
			controls.update();
			schedule();
		}
		return runtime;
	} catch (error) {
		dispose();
		throw error;
	}
}
