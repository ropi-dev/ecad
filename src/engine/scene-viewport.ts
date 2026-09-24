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
import { createLifecycle } from "#/lib/lifecycle";
import { getSceneBounds } from "./camera";
import { capturePng } from "./capture-png";
import { create3DControls } from "./controls3d";
import {
	handleViewerKeyDown,
	MAX_ZOOM,
	MIN_ZOOM,
	viewerPixelRatio,
} from "./navigation";
import { createSceneDisplay, type ViewerScene } from "./scene";
import { createSceneHover, type SceneTarget } from "./scene-hover";
import type { Viewer2DSnapshot, Viewer3DHandle } from "./viewport-types";

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
	selectionEnabled?: boolean;
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
		selectionEnabled = true,
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
	const schedule = () => {
		if (disposed || frame !== null) return;
		frame = requestAnimationFrame(() => {
			frame = null;
			draw();
		});
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
			() => new WebGLRenderer({ antialias: true, alpha: true, stencil: true }),
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
		const scene = new Scene();
		scene.add(group, new HemisphereLight("white", "#566173", 2.5));
		const light = new DirectionalLight("white", 3);
		light.position.set(1, -2, 3);
		scene.add(light);
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
				() => new GridHelper(radius * 6, 60, "#64748b", "#334155"),
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
		let fittedDistance = 1;
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
		const clearSelection = () => {
			selected = null;
			onSelection?.(null);
			schedule();
		};
		draw = () => {
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
				onOrientation?.(camera.quaternion);
				const currentZoom =
					fittedDistance / (visibleHeight() / (2 * halfFovTangent));
				onZoom?.(
					Math.round(
						Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom)) * 1e6,
					) / 1e6,
				);
				if (topView) {
					const width = Math.max(element.clientWidth, 1);
					const height = Math.max(element.clientHeight, 1);
					onChange?.({
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
					onReady?.(true);
				}
			} catch (error) {
				cancel();
				onReady?.(false);
				onError?.(
					error instanceof Error ? error.message : "Unable to draw this scene.",
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
							(sheetSize.x * viewportHeight) / Math.max(viewportWidth - 144, 1),
						) /
						(2 * halfFovTangent)
					: (radius / Math.sin(halfFov)) * 1.3;
			camera.position
				.copy(sphere.center)
				.addScaledVector(
					direction,
					fitDistance / (Number.isFinite(fitZoom) && fitZoom > 0 ? fitZoom : 1),
				);
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
		controls.addEventListener("change", schedule);
		lifecycle.addFinalizer(() =>
			controls.removeEventListener("change", schedule),
		);
		const runtime: SceneViewportRuntime = {
			dispose,
			fit: reset,
			pan,
			zoom,
			view,
			resize,
			setProjection,
			capture: () => {
				if (output.getContext().isContextLost())
					throw new Error("The graphics context is unavailable.");
				// Render and copy in the same task; preserveDrawingBuffer stays disabled.
				camera.updateMatrixWorld();
				content.update(output, camera);
				output.render(scene, camera);
				return capturePng(canvas);
			},
			update: (update) => {
				update(group);
				schedule();
			},
		};
		resize(Math.max(element.clientWidth, 1), Math.max(element.clientHeight, 1));
		view(topView ? "top" : "iso");
		setProjection(projection);
		return runtime;
	} catch (error) {
		dispose();
		throw error;
	}
}
