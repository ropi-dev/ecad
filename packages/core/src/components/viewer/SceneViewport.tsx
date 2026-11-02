import {
	type ReactNode,
	type Ref,
	useEffect,
	useEffectEvent,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import type { Object3D } from "three";
import { formatShortcut } from "#/components/viewer/shortcutModifier.ts";
import type { ViewerScene } from "#/engine/scene.ts";
import {
	createSceneViewport,
	type SceneSelection,
	type SceneViewportRuntime,
} from "#/engine/scene-viewport.ts";
import type { Bounds } from "#/engine/types.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { AxisIndicator } from "./AxisIndicator";
import { downloadPng } from "./exportPng";
import { FloatingPanel } from "./FloatingPanel";
import type { AxisIndicatorHandle } from "./types/AxisIndicatorHandle";
import type { Viewer2DSnapshot } from "./types/Viewer2DSnapshot";
import type { Viewer3DHandle } from "./types/Viewer3DHandle";
import { useDisplayScale } from "./useDisplayScale.ts";
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
	/** Magnification applied to the fitted view that defines 100% zoom. */
	fitZoom?: number;
	physicalSizeZoom?: boolean;
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
	groupedControls?: boolean;
}

export function SceneViewport({
	scene: sourceScene,
	cameraMode,
	projection = "perspective",
	lockProjection = false,
	fitZoom = 1,
	physicalSizeZoom = false,
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
	groupedControls = false,
}: SceneViewportProps) {
	const [selectionInfo, setSelectionInfo] = useState<SceneSelection | null>(
		null,
	);
	const [controlsReady, setControlsReady] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [exportError, setExportError] = useState("");
	const [zoomLevel, setZoomLevel] = useState(1);
	const [activeProjection, setActiveProjection] = useState(projection);
	useEffect(() => setActiveProjection(projection), [projection]);
	const displayScale = useDisplayScale(physicalSizeZoom);
	const host = useRef<HTMLDivElement>(null);
	const size = useViewportSize(host);
	const axes = useRef<AxisIndicatorHandle>(null);
	const rulers = useRef<ViewportRulersHandle>(null);
	const reportChange = useEffectEvent((snapshot: Viewer2DSnapshot) => {
		rulers.current?.update(snapshot);
		onChange?.(snapshot);
	});
	const configureDisplay = useEffectEvent((viewport: SceneViewportRuntime) => {
		viewport.setPhysicalScale(displayScale);
	});
	const readFitBounds = useEffectEvent(() => getFitBounds?.() ?? null);
	const reportReady = useEffectEvent((ready: boolean) => {
		setControlsReady(ready);
		onReady?.(ready);
	});
	const reportError = useEffectEvent((message: string) => onError?.(message));
	const runtime = useRef<SceneViewportRuntime | null>(null);
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
						getFitBounds: readFitBounds,
						selectionEnabled,
						ariaLabel: formatShortcut(
							interactionHint
								? `${ariaLabel}. ${interactionHint}`
								: cameraMode === "top"
									? `${ariaLabel}. Top view locked. Drag or swipe to pan; pinch or Ctrl + scroll to zoom. Arrow keys pan, plus or minus zooms, and F6 fits the scene.`
									: `${ariaLabel}. Shift + left-drag to orbit and Ctrl + left-drag to pan. Two-finger swipe to pan, Shift + two-finger swipe to orbit, pinch or Ctrl + scroll to zoom toward the pointer. Middle-drag to pan and Shift + middle-drag to orbit with a mouse. Double-click the middle button or press F6 to fit. Arrow keys pan, plus or minus zooms. On touchscreens, drag to orbit and use two fingers to pan or pinch to zoom.`,
						),
						canvasClassName:
							"block h-full w-full touch-none focus-visible:outline-2 focus-visible:outline-amber-200",
						updateScene: sceneUpdate.current,
						onChange: reportChange,
						onSelection: setSelectionInfo,
						onOrientation: (rotation) => axes.current?.update(rotation),
						onZoom: setZoomLevel,
						onReady: reportReady,
						onError: reportError,
					}),
				{ objects: sourceScene.length },
			);
			runtime.current = viewport;
			configureDisplay(viewport);
		} catch (error) {
			reportError(
				`3D viewer unavailable: ${error instanceof Error ? error.message : "WebGL is not supported in this browser."}`,
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
	]);
	useEffect(() => {
		runtime.current?.setPhysicalScale(displayScale);
	}, [displayScale]);
	useEffect(() => {
		runtime.current?.resize(size.width, size.height);
	}, [size]);
	const exportPng = async () => {
		if (!runtime.current || exporting) return;
		setExporting(true);
		setExportError("");
		try {
			const blob = await runtime.current.capture();
			downloadPng(blob, ariaLabel);
		} catch (error) {
			setExportError(
				`PNG export failed: ${error instanceof Error ? error.message : "Please try again."}`,
			);
		} finally {
			setExporting(false);
		}
	};
	return (
		<>
			<div ref={host} className="absolute inset-0 z-1 overflow-hidden" />
			{exportError && (
				<p
					role="alert"
					className="absolute bottom-32 left-1/2 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg border border-amber-200/30 bg-slate-900 p-3 text-sm text-amber-200"
				>
					{exportError}
				</p>
			)}
			{selectionInfo && (
				<FloatingPanel label="Selection attributes" position="top-right">
					<div className="min-h-0 overflow-y-auto overscroll-contain p-2.5">
						<p className="break-words text-[14px] leading-[1.7] text-[#e8b77e]">
							{selectionInfo.name || "Unnamed component"}
						</p>
						<dl className="my-4 text-[12px]">
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
									className="flex justify-between gap-3 border-b border-[#ffffff0a] py-2"
								>
									<dt className="text-[#9ba7b8]">{label}</dt>
									<dd className="min-w-0 break-words text-right tabular-nums">
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
					enabled={controlsReady}
					zoomLevel={zoomLevel}
					actualSize={
						displayScale !== null
							? () => runtime.current?.actualSize()
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
