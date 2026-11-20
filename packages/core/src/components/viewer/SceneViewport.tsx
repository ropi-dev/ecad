import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type { JSX } from "@solidjs/web";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
	Show,
	untrack,
} from "solid-js";
import type { Object3D } from "three";
import { AxisIndicator } from "#/components/viewer/AxisIndicator.tsx";
import { useAntialiasing } from "#/components/viewer/antialiasing.ts";
import { downloadPng } from "#/components/viewer/exportPng.ts";
import {
	FloatingPanel,
	type FloatingPanelPosition,
} from "#/components/viewer/FloatingPanel.tsx";
import { formatShortcut } from "#/components/viewer/shortcutModifier.ts";
import type { AxisIndicatorHandle } from "#/components/viewer/types/AxisIndicatorHandle.ts";
import type { Viewer2DSnapshot } from "#/components/viewer/types/Viewer2DSnapshot.ts";
import type { Viewer3DHandle } from "#/components/viewer/types/Viewer3DHandle.ts";
import { useDisplayScale } from "#/components/viewer/useDisplayScale.ts";
import { useViewportSize } from "#/components/viewer/useViewportSize.ts";
import { ViewControls3D } from "#/components/viewer/ViewControls3D.tsx";
import {
	ViewportRulers,
	type ViewportRulersHandle,
} from "#/components/viewer/ViewportRulers.tsx";
import { schematicThemes } from "#/drawing/schematic-theme.ts";
import type { OrbitGesture } from "#/engine/controls3d.ts";
import type { GridUnit } from "#/engine/ruler.ts";
import type { ViewerScene } from "#/engine/scene.ts";
import {
	createSceneViewport,
	type SceneSelection,
	type SceneViewportRuntime,
} from "#/engine/scene-viewport.ts";
import type { Bounds, Camera } from "#/engine/types.ts";
import { shallowEqual } from "#/lib/external-store.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { useTheme } from "#/settings/theme.ts";

/** The shortest time between two updates of the toolbar's zoom label. */
const ZOOM_LABEL_MS = 100;

export interface SceneViewportHandle extends Viewer3DHandle {
	pan: (x: number, y: number) => void;
}

export interface SceneViewportProps {
	scene: ViewerScene;
	cameraMode: "top" | "orbit";
	projection?: "perspective" | "orthographic";
	lockProjection?: boolean;
	/** Magnification applied to the fitted view that defines 100% zoom. */
	fitZoom?: number;
	physicalSizeZoom?: boolean;
	pixelsPerMmAt100?: number;
	cameraState?: { camera?: Camera };
	keepView?: boolean;
	getFitBounds?: () => Bounds | null;
	selectionEnabled?: boolean;
	hoverHighlight?: boolean;
	orbit?: boolean;
	gestureOrbit?: OrbitGesture;
	onOrbit?: (orbiting: boolean) => void;
	selectionPosition?: FloatingPanelPosition;
	interactionHint?: string;
	/** Keep the grid at full opacity here and fade it to 30% outside these world bounds. */
	gridBounds?: Bounds;
	showGrid?: boolean;
	rulerUnit?: GridUnit;
	onChange?: (snapshot: Viewer2DSnapshot) => void;
	/** Updates the existing object without replacing the scene or resetting the camera. */
	updateScene?: (object: Object3D) => void;
	ref?: (handle: SceneViewportHandle) => void;
	onReady?: (ready: boolean) => void;
	onError?: (message: string) => void;
	ariaLabel?: string;
	extraControls?: JSX.Element;
	/** Grouped toolbars place these after the zoom controls. */
	trailingControls?: JSX.Element;
	groupedControls?: boolean;
	scrollableControls?: boolean;
	/** Accessible name of the bottom toolbar. */
	controlsLabel?: string;
}

type Projection = "perspective" | "orthographic";

const sameBounds = (a: Bounds | undefined, b: Bounds | undefined) =>
	a === b ||
	(a !== undefined &&
		b !== undefined &&
		a.minX === b.minX &&
		a.maxX === b.maxX &&
		a.minY === b.minY &&
		a.maxY === b.maxY);

export function SceneViewport(props: SceneViewportProps) {
	const ariaLabel = () => props.ariaLabel ?? "3D model";
	const [selectionInfo, setSelectionInfo] = createSignal<SceneSelection | null>(
		null,
	);
	const [attributesOpen, setAttributesOpen] = createSignal(false);
	const [controlsReady, setControlsReady] = createSignal(false);
	const [exporting, setExporting] = createSignal(false);
	const [exportError, setExportError] = createSignal("");
	const [zoomLevel, setZoomLevel] = createSignal(1);
	let runtime: SceneViewportRuntime | undefined;
	let mounted = false;
	// A continuous zoom changes the level on every frame, and each change
	// repaints the toolbar. The label follows a wheel or pinch at most every
	// ZOOM_LABEL_MS and always shows the level the zoom ends on.
	const zoomLabel: {
		shown: number;
		latest: number;
		time: number;
		timer?: ReturnType<typeof setTimeout>;
	} = { shown: 1, latest: 1, time: Number.NEGATIVE_INFINITY };
	const showZoom = () => {
		clearTimeout(zoomLabel.timer);
		zoomLabel.timer = undefined;
		zoomLabel.time = performance.now();
		zoomLabel.shown = zoomLabel.latest;
		setZoomLevel(zoomLabel.latest);
	};
	const reportZoom = (zoom: number) => {
		zoomLabel.latest = zoom;
		if (zoomLabel.timer !== undefined || zoom === zoomLabel.shown) return;
		const wait = zoomLabel.time + ZOOM_LABEL_MS - performance.now();
		if (wait <= 0) showZoom();
		else zoomLabel.timer = setTimeout(showZoom, wait);
	};
	/** A zoom chosen in one step, such as a toolbar button, shows its level at once. */
	const stepZoom = (step: (viewport: SceneViewportRuntime) => void) => {
		showZoom();
		zoomLabel.time = Number.NEGATIVE_INFINITY;
		if (runtime) step(runtime);
	};
	onSettled(() => () => clearTimeout(zoomLabel.timer));
	const [flatProjection, setFlatProjection] = createSignal<Projection>(
		() => props.projection ?? "perspective",
	);
	const [orbitProjection, setOrbitProjection] =
		createSignal<Projection>("perspective");
	const [orbiting, setOrbiting] = createSignal(false);
	let orbitingNow = false;
	const activeProjection = createMemo(() =>
		orbiting() ? orbitProjection() : flatProjection(),
	);
	const reportOrbit = (next: boolean) =>
		untrack(() => {
			if (next && !orbitingNow) setOrbitProjection("perspective");
			orbitingNow = next;
			setOrbiting(next);
			props.onOrbit?.(next);
		});
	const displayScale = useDisplayScale(() => props.physicalSizeZoom ?? false);
	const zoomScale = createMemo(() =>
		props.lockProjection ? (props.pixelsPerMmAt100 ?? displayScale()) : null,
	);
	const antialias = useAntialiasing();
	let ownCamera: { camera?: Camera; scene?: ViewerScene } = {};
	const [host, setHost] = createSignal<HTMLDivElement>();
	const size = useViewportSize(host);
	let axes: AxisIndicatorHandle | undefined;
	let rulers: ViewportRulersHandle | undefined;
	const rulersShown = createMemo(
		() => props.cameraMode === "top" && !orbiting(),
	);
	const axesShown = createMemo(
		() => props.cameraMode === "orbit" || orbiting(),
	);
	const reportChange = (snapshot: Viewer2DSnapshot) =>
		untrack(() => {
			if (rulersShown()) rulers?.update(snapshot);
			if (props.cameraState) props.cameraState.camera = snapshot.camera;
			props.onChange?.(snapshot);
		});
	const theme = useTheme();
	const gridBounds = createMemo(() => props.gridBounds, { equals: sameBounds });
	const grid = createMemo(() => {
		if (props.cameraMode !== "top" || !(props.showGrid ?? true)) return null;
		const { grid: color, gridMajor: majorColor } = schematicThemes[theme()];
		const bounds = gridBounds();
		return {
			unit: props.rulerUnit ?? "mm",
			color,
			majorColor,
			bounds: bounds && {
				minX: bounds.minX,
				maxX: bounds.maxX,
				minY: bounds.minY,
				maxY: bounds.maxY,
			},
		};
	});
	const reportReady = (ready: boolean) =>
		untrack(() => {
			setControlsReady(ready);
			props.onReady?.(ready);
		});
	const reportError = (message: string) =>
		untrack(() => props.onError?.(message));
	props.ref?.({
		fit: () => stepZoom((viewport) => viewport.fit()),
		zoom: (factor) => stepZoom((viewport) => viewport.zoom(factor)),
		view: (direction) => stepZoom((viewport) => viewport.view(direction)),
		pan: (x, y) => runtime?.pan(x, y),
	});
	const orbit = createMemo(() => props.orbit ?? false);
	createEffect(orbit, (enabled) => {
		runtime?.setOrbit(enabled);
	});
	createEffect(activeProjection, (projection) => {
		runtime?.setProjection(projection);
	});
	let shownScene: ViewerScene | null = null;
	const [restarts, setRestarts] = createSignal(0);
	createEffect(
		() => [props.updateScene, props.scene] as const,
		([update, scene]) => {
			if (update && shownScene === scene) runtime?.update(update);
		},
	);
	const mount = createMemo(
		() => ({
			options: {
				host: host(),
				key: props.keepView ? restarts() : props.scene,
				cameraMode: props.cameraMode,
				ariaLabel: ariaLabel(),
				interactionHint: props.interactionHint,
				selectionEnabled: props.selectionEnabled ?? true,
				hoverHighlight: props.hoverHighlight ?? true,
				gestureOrbit: props.gestureOrbit,
				lockProjection: props.lockProjection ?? false,
				fitZoom: props.fitZoom ?? 1,
				pixelsPerMmAt100: props.pixelsPerMmAt100,
				cameraState: props.cameraState,
				antialias: antialias(),
			},
			current: {
				scene: props.scene,
				projection: activeProjection(),
				orbit: orbit(),
				updateScene: props.updateScene,
				zoomScale: zoomScale(),
				grid: grid(),
			},
		}),
		{ equals: (a, b) => shallowEqual(a.options, b.options) },
	);
	createEffect(mount, ({ options, current }) => {
		const element = options.host;
		if (!element) return;
		const sourceScene = current.scene;
		const fitBounds = () => untrack(() => props.getFitBounds?.() ?? null);
		let notReady = 0;
		if (!mounted) reportReady(false);
		else notReady = requestAnimationFrame(() => reportReady(false));
		setSelectionInfo(null);
		setAttributesOpen(false);
		let viewport: SceneViewportRuntime | undefined;
		try {
			viewport = measurePerformance(
				"renderer.initialize",
				() =>
					createSceneViewport(element, {
						scene: sourceScene,
						cameraMode: options.cameraMode,
						projection: current.projection,
						lockProjection: options.lockProjection,
						fitZoom: options.fitZoom,
						pixelsPerMmAt100: options.pixelsPerMmAt100,
						initialCamera:
							options.cameraState?.camera ??
							(ownCamera.scene === sourceScene ? ownCamera.camera : undefined),
						getFitBounds: () => fitBounds(),
						selectionEnabled: options.selectionEnabled,
						hoverHighlight: options.hoverHighlight,
						orbit: current.orbit,
						gestureOrbit: options.gestureOrbit,
						antialias: options.antialias,
						ariaLabel: formatShortcut(
							options.interactionHint
								? `${options.ariaLabel}. ${options.interactionHint}`
								: options.cameraMode === "top"
									? `${options.ariaLabel}. Top view locked. Drag or swipe to pan; pinch or Ctrl + scroll to zoom. Arrow keys pan, plus or minus zooms, and F6 fits the scene.`
									: `${options.ariaLabel}. Middle-drag or two-finger scroll to pan, Shift + middle-drag or Shift + two-finger scroll to orbit, and mouse wheel or pinch to zoom toward the pointer. Shift + left-drag also orbits and Ctrl + left-drag also pans. Double-click the middle button or press F6 to fit. Arrow keys pan, plus or minus zooms. On touchscreens, drag to orbit and use two fingers to pan or pinch to zoom.`,
						),
						canvasClassName:
							"block h-full w-full touch-none focus-visible:outline-2 focus-visible:outline-accent",
						updateScene: current.updateScene,
						onChange: (snapshot) => {
							ownCamera = { camera: snapshot.camera, scene: sourceScene };
							reportChange(snapshot);
						},
						onSelection: (selection) => {
							setSelectionInfo(selection);
							setAttributesOpen(false);
						},
						onOpenSelection: () => setAttributesOpen(true),
						onOrientation: (rotation) => {
							if (axesShown()) axes?.update(rotation);
						},
						onOrbit: reportOrbit,
						onZoom: reportZoom,
						onReady: (ready) => {
							cancelAnimationFrame(notReady);
							reportReady(ready);
						},
						onError: reportError,
					}),
				{ objects: sourceScene.length },
			);
			runtime = viewport;
			mounted = true;
			shownScene = sourceScene;
			viewport.setPhysicalScale(current.zoomScale);
			viewport.setGrid(current.grid);
			reportOrbit(options.cameraMode === "top" && current.orbit);
		} catch (error) {
			cancelAnimationFrame(notReady);
			mounted = false;
			reportReady(false);
			reportError(
				`3D viewer unavailable: ${errorMessage(error, "WebGL is not supported in this browser.")}`,
			);
		}
		return () => {
			cancelAnimationFrame(notReady);
			runtime = undefined;
			shownScene = null;
			viewport?.dispose();
		};
	});
	createEffect(
		() => [props.keepView ?? false, props.scene, props.updateScene] as const,
		([keepView, scene, update]) => {
			if (!keepView || !runtime || shownScene === scene) return;
			let swapped = false;
			try {
				swapped = runtime.setScene(scene, update);
			} catch (error) {
				if (import.meta.env?.DEV) console.error(error);
			}
			if (swapped) shownScene = scene;
			else setRestarts((count) => count + 1);
		},
	);
	createEffect(zoomScale, (scale) => {
		runtime?.setPhysicalScale(scale);
	});
	createEffect(grid, (options) => {
		runtime?.setGrid(options);
	});
	let shownTheme: string | undefined;
	createEffect(theme, (current) => {
		if (shownTheme !== undefined && shownTheme !== current)
			runtime?.refreshTheme();
		shownTheme = current;
	});
	createEffect(size, (current) => {
		if (current) runtime?.resize(current.width, current.height);
	});
	let exportRunning = false;
	const exportPng = async () => {
		if (!runtime || exportRunning) return;
		exportRunning = true;
		setExporting(true);
		setExportError("");
		try {
			const blob = await runtime.capture();
			downloadPng(blob, ariaLabel());
		} catch (error) {
			setExportError(
				`PNG export failed: ${errorMessage(error, "Please try again.")}`,
			);
		} finally {
			exportRunning = false;
			setExporting(false);
		}
	};
	const toggleProjection = () =>
		(orbiting() ? setOrbitProjection : setFlatProjection)((current) =>
			current === "perspective" ? "orthographic" : "perspective",
		);
	const actualSize = () => stepZoom((viewport) => viewport.actualSize());
	const fit = () => stepZoom((viewport) => viewport.fit());
	const zoom = (factor: number) =>
		stepZoom((viewport) => viewport.zoom(factor));
	const view = (direction: Parameters<Viewer3DHandle["view"]>[0]) =>
		stepZoom((viewport) => viewport.view(direction));
	return (
		<>
			<div ref={setHost} class="absolute inset-0 z-1 overflow-hidden" />
			<Show when={exportError()}>
				<p
					role="alert"
					class="ui-notice absolute bottom-[calc(var(--chrome-dock)+8px)] left-1/2 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2 px-3 py-2"
				>
					{exportError()}
				</p>
			</Show>
			<Show when={attributesOpen() ? selectionInfo() : null}>
				{(info) => (
					<FloatingPanel
						label="Selection attributes"
						position={props.selectionPosition ?? "top-right"}
					>
						<header class="shrink-0 border-b border-line-subtle px-3 py-2.5">
							<p class="m-0 break-words text-sm font-semibold">
								{info().name || "Unnamed component"}
							</p>
						</header>
						<div class="min-h-0 overflow-y-auto overscroll-contain px-3 py-1.5">
							<dl class="m-0 text-xs">
								<For
									each={[
										[
											"Type",
											info().region === undefined
												? "3D part"
												: `Connected shape ${(info().region ?? 0) + 1}`,
										],
										[
											"Dimensions",
											`${info()
												.dimensions.map((value) => value.toFixed(2))
												.join(" × ")} mm`,
										],
									]}
								>
									{([label, value]) => (
										<div class="flex min-h-8 items-center justify-between gap-3">
											<dt class="text-fg-muted">{label}</dt>
											<dd class="m-0 min-w-0 break-words text-right tabular-nums">
												{value}
											</dd>
										</div>
									)}
								</For>
							</dl>
						</div>
					</FloatingPanel>
				)}
			</Show>
			<Show when={rulersShown()}>
				<ViewportRulers
					unit={props.rulerUnit}
					ref={(handle) => {
						rulers = handle;
					}}
					gridBounds={props.gridBounds}
				/>
			</Show>
			<Show when={axesShown()}>
				<AxisIndicator
					ref={(handle: AxisIndicatorHandle) => {
						axes = handle;
					}}
				/>
			</Show>
			<Show when={controlsReady()}>
				<ViewControls3D
					grouped={props.groupedControls ?? false}
					scrollable={props.scrollableControls ?? false}
					trailing={props.trailingControls}
					label={props.controlsLabel}
					enabled={controlsReady()}
					zoomLevel={zoomLevel()}
					absoluteZoom={zoomScale() !== null}
					actualSize={displayScale() !== null ? actualSize : undefined}
					exportPng={exportPng}
					exporting={exporting()}
					projection={activeProjection()}
					toggleProjection={props.lockProjection ? undefined : toggleProjection}
					fit={fit}
					zoom={zoom}
					view={props.cameraMode === "orbit" ? view : undefined}
					fitLabel={props.cameraMode === "top" ? "Fit drawing" : "Fit model"}
				>
					{props.extraControls}
				</ViewControls3D>
			</Show>
		</>
	);
}
