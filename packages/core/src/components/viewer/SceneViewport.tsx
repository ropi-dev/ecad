import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	type ReactNode,
	type Ref,
	useCallback,
	useEffect,
	useEffectEvent,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Object3D } from "three";
import { AxisIndicator } from "#/components/viewer/AxisIndicator.tsx";
import {
	setAntialiasing,
	useAntialiasing,
} from "#/components/viewer/antialiasing.ts";
import { downloadPng } from "#/components/viewer/exportPng.ts";
import { FloatingPanel } from "#/components/viewer/FloatingPanel.tsx";
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
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import type { ViewerScene } from "#/engine/scene.ts";
import {
	createSceneViewport,
	type SceneSelection,
	type SceneViewportRuntime,
} from "#/engine/scene-viewport.ts";
import type { Bounds, Camera } from "#/engine/types.ts";
import { measurePerformance } from "#/performance/runtime.ts";

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
	cameraState?: { camera?: Camera };
	getFitBounds?: () => Bounds | null;
	selectionEnabled?: boolean;
	interactionHint?: string;
	/** Keep the grid at full opacity here and fade it to 30% outside these world bounds. */
	gridBounds?: Bounds;
	rulerUnit?: "mm" | "mil";
	onChange?: (snapshot: Viewer2DSnapshot) => void;
	/** Updates the existing object without replacing the scene or resetting the camera. */
	updateScene?: (object: Object3D) => void;
	ref?: Ref<SceneViewportHandle>;
	onReady?: (ready: boolean) => void;
	onError?: (message: string) => void;
	ariaLabel?: string;
	extraControls?: ReactNode;
	/** Grouped toolbars place these after the zoom controls. */
	trailingControls?: ReactNode;
	groupedControls?: boolean;
	/** Accessible name of the bottom toolbar. */
	controlsLabel?: string;
}

export function SceneViewport({
	scene: sourceScene,
	cameraMode,
	projection = "perspective",
	lockProjection = false,
	fitZoom = 1,
	physicalSizeZoom = false,
	cameraState,
	getFitBounds,
	selectionEnabled = true,
	interactionHint,
	gridBounds,
	rulerUnit,
	onChange,
	updateScene,
	ref,
	onReady,
	onError,
	ariaLabel = "3D model",
	extraControls,
	trailingControls,
	groupedControls = false,
	controlsLabel,
}: SceneViewportProps) {
	const [selectionInfo, setSelectionInfo] = useState<SceneSelection | null>(
		null,
	);
	const [controlsReady, setControlsReady] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [exportError, setExportError] = useState("");
	const [zoomLevel, setZoomLevel] = useState(1);
	const runtime = useRef<SceneViewportRuntime | null>(null);
	// A continuous zoom changes the level on every frame, and each change
	// re-renders and repaints the toolbar. The label follows a wheel or pinch
	// at most every ZOOM_LABEL_MS and always shows the level the zoom ends on.
	const zoomLabel = useRef<{
		shown: number;
		latest: number;
		time: number;
		timer?: ReturnType<typeof setTimeout>;
	}>({ shown: 1, latest: 1, time: Number.NEGATIVE_INFINITY });
	const showZoom = useCallback(() => {
		const label = zoomLabel.current;
		clearTimeout(label.timer);
		label.timer = undefined;
		label.time = performance.now();
		label.shown = label.latest;
		setZoomLevel(label.latest);
	}, []);
	const reportZoom = useEffectEvent((zoom: number) => {
		const label = zoomLabel.current;
		label.latest = zoom;
		if (label.timer !== undefined || zoom === label.shown) return;
		const wait = label.time + ZOOM_LABEL_MS - performance.now();
		if (wait <= 0) showZoom();
		else label.timer = setTimeout(showZoom, wait);
	});
	/** A zoom chosen in one step, such as a toolbar button, shows its level at once. */
	const stepZoom = useCallback(
		(step: (viewport: SceneViewportRuntime) => void) => {
			showZoom();
			zoomLabel.current.time = Number.NEGATIVE_INFINITY;
			if (runtime.current) step(runtime.current);
		},
		[showZoom],
	);
	useEffect(() => () => clearTimeout(zoomLabel.current.timer), []);
	const [activeProjection, setActiveProjection] = useState(projection);
	useEffect(() => setActiveProjection(projection), [projection]);
	const displayScale = useDisplayScale(physicalSizeZoom);
	const antialias = useAntialiasing();
	const ownCamera = useRef<{ camera?: Camera; scene?: ViewerScene }>({});
	const host = useRef<HTMLDivElement>(null);
	const size = useViewportSize(host);
	const axes = useRef<AxisIndicatorHandle>(null);
	const rulers = useRef<ViewportRulersHandle>(null);
	const reportChange = useEffectEvent((snapshot: Viewer2DSnapshot) => {
		rulers.current?.update(snapshot);
		if (cameraState) cameraState.camera = snapshot.camera;
		onChange?.(snapshot);
	});
	const gridMinX = gridBounds?.minX;
	const gridMaxX = gridBounds?.maxX;
	const gridMinY = gridBounds?.minY;
	const gridMaxY = gridBounds?.maxY;
	// Callers pass new bounds objects on every render; key the grid on values.
	const grid = useMemo(
		() =>
			cameraMode === "top"
				? {
						unit: rulerUnit ?? "mm",
						color: darkSchematicTheme.grid,
						bounds:
							gridMinX === undefined ||
							gridMaxX === undefined ||
							gridMinY === undefined ||
							gridMaxY === undefined
								? undefined
								: {
										minX: gridMinX,
										maxX: gridMaxX,
										minY: gridMinY,
										maxY: gridMaxY,
									},
					}
				: null,
		[cameraMode, rulerUnit, gridMinX, gridMaxX, gridMinY, gridMaxY],
	);
	const configureDisplay = useEffectEvent((viewport: SceneViewportRuntime) => {
		viewport.setPhysicalScale(displayScale);
		viewport.setGrid(grid);
	});
	const readFitBounds = useEffectEvent(() => getFitBounds?.() ?? null);
	const reportReady = useEffectEvent((ready: boolean) => {
		setControlsReady(ready);
		onReady?.(ready);
	});
	const reportError = useEffectEvent((message: string) => onError?.(message));
	useImperativeHandle(
		ref,
		() => ({
			fit: () => stepZoom((viewport) => viewport.fit()),
			zoom: (factor) => stepZoom((viewport) => viewport.zoom(factor)),
			view: (direction) => stepZoom((viewport) => viewport.view(direction)),
			pan: (x, y) => runtime.current?.pan(x, y),
		}),
		[stepZoom],
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
		let viewport: SceneViewportRuntime | undefined;
		try {
			viewport = measurePerformance(
				"renderer.initialize",
				() =>
					createSceneViewport(element, {
						scene: sourceScene,
						cameraMode,
						projection: currentProjection.current,
						lockProjection,
						fitZoom,
						initialCamera:
							cameraState?.camera ??
							(ownCamera.current.scene === sourceScene
								? ownCamera.current.camera
								: undefined),
						getFitBounds: readFitBounds,
						selectionEnabled,
						antialias,
						ariaLabel: formatShortcut(
							interactionHint
								? `${ariaLabel}. ${interactionHint}`
								: cameraMode === "top"
									? `${ariaLabel}. Top view locked. Drag or swipe to pan; pinch or Ctrl + scroll to zoom. Arrow keys pan, plus or minus zooms, and F6 fits the scene.`
									: `${ariaLabel}. Shift + left-drag to orbit and Ctrl + left-drag to pan. Two-finger swipe to pan, Shift + two-finger swipe to orbit, pinch or Ctrl + scroll to zoom toward the pointer. Middle-drag to pan and Shift + middle-drag to orbit with a mouse. Double-click the middle button or press F6 to fit. Arrow keys pan, plus or minus zooms. On touchscreens, drag to orbit and use two fingers to pan or pinch to zoom.`,
						),
						canvasClassName:
							"block h-full w-full touch-none focus-visible:outline-2 focus-visible:outline-accent",
						updateScene: sceneUpdate.current,
						onChange: (snapshot) => {
							ownCamera.current = {
								camera: snapshot.camera,
								scene: sourceScene,
							};
							reportChange(snapshot);
						},
						onSelection: setSelectionInfo,
						onOrientation: (rotation) => axes.current?.update(rotation),
						onZoom: reportZoom,
						onReady: reportReady,
						onError: reportError,
					}),
				{ objects: sourceScene.length },
			);
			runtime.current = viewport;
			configureDisplay(viewport);
		} catch (error) {
			reportError(
				`3D viewer unavailable: ${errorMessage(error, "WebGL is not supported in this browser.")}`,
			);
		}
		return () => {
			runtime.current = null;
			viewport?.dispose();
		};
	}, [
		sourceScene,
		cameraMode,
		ariaLabel,
		interactionHint,
		selectionEnabled,
		lockProjection,
		fitZoom,
		cameraState,
		antialias,
	]);
	useEffect(() => {
		runtime.current?.setPhysicalScale(displayScale);
	}, [displayScale]);
	useEffect(() => {
		runtime.current?.setGrid(grid);
	}, [grid]);
	useEffect(() => {
		runtime.current?.resize(size.width, size.height);
	}, [size]);
	const exportingRef = useRef(false);
	// Stable, so toolbars reading it through context don't re-render on zoom.
	const exportPng = useCallback(async () => {
		if (!runtime.current || exportingRef.current) return;
		exportingRef.current = true;
		setExporting(true);
		setExportError("");
		try {
			const blob = await runtime.current.capture();
			downloadPng(blob, ariaLabel);
		} catch (error) {
			setExportError(
				`PNG export failed: ${errorMessage(error, "Please try again.")}`,
			);
		} finally {
			exportingRef.current = false;
			setExporting(false);
		}
	}, [ariaLabel]);
	return (
		<>
			<div ref={host} className="absolute inset-0 z-1 overflow-hidden" />
			{exportError && (
				<p
					role="alert"
					className="ui-notice absolute bottom-[calc(var(--chrome-dock)+8px)] left-1/2 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2 px-3 py-2"
				>
					{exportError}
				</p>
			)}
			{selectionInfo && (
				<FloatingPanel label="Selection attributes" position="top-right">
					<header className="shrink-0 border-b border-line-subtle px-3 py-2.5">
						<p className="m-0 break-words text-sm font-semibold">
							{selectionInfo.name || "Unnamed component"}
						</p>
					</header>
					<div className="min-h-0 overflow-y-auto overscroll-contain px-3 py-1.5">
						<dl className="m-0 text-xs">
							{[
								[
									"Type",
									selectionInfo.region === undefined
										? "3D part"
										: `Connected shape ${selectionInfo.region + 1}`,
								],
								[
									"Dimensions",
									`${selectionInfo.dimensions.map((value) => value.toFixed(2)).join(" × ")} mm`,
								],
							].map(([label, value]) => (
								<div
									key={label}
									className="flex min-h-8 items-center justify-between gap-3"
								>
									<dt className="text-fg-muted">{label}</dt>
									<dd className="m-0 min-w-0 break-words text-right tabular-nums">
										{value}
									</dd>
								</div>
							))}
						</dl>
					</div>
				</FloatingPanel>
			)}
			{cameraMode === "top" && (
				<ViewportRulers unit={rulerUnit} ref={rulers} gridBounds={gridBounds} />
			)}
			{cameraMode === "orbit" && <AxisIndicator ref={axes} />}
			{controlsReady && (
				<ViewControls3D
					grouped={groupedControls}
					trailing={trailingControls}
					label={controlsLabel}
					enabled={controlsReady}
					zoomLevel={zoomLevel}
					actualSize={
						displayScale !== null
							? () => stepZoom((viewport) => viewport.actualSize())
							: undefined
					}
					exportPng={exportPng}
					exporting={exporting}
					projection={activeProjection}
					toggleProjection={
						lockProjection
							? undefined
							: () =>
									setActiveProjection((current) =>
										current === "perspective" ? "orthographic" : "perspective",
									)
					}
					antialias={antialias}
					toggleAntialias={
						cameraMode === "top" ? () => setAntialiasing(!antialias) : undefined
					}
					fit={() => stepZoom((viewport) => viewport.fit())}
					zoom={(factor) => stepZoom((viewport) => viewport.zoom(factor))}
					view={
						cameraMode === "orbit"
							? (direction) => stepZoom((viewport) => viewport.view(direction))
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
