import type {
	EditorSymbol,
	ResizeHandle,
	SymbolChild,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	type EditorShape,
	shapeBounds,
	symbolChildWorld,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	shapeLayer,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { Diff, Minus, Plus } from "lucide-react";
import {
	memo,
	type RefObject,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import type { CanvasView } from "#/components/editor/canvasView.ts";
import { RulerPositionGuide } from "#/components/editor/RulerPositionGuide.tsx";
import { SymbolAnchors } from "#/components/editor/SymbolAnchors.tsx";
import type { SelectionMode } from "#/components/editor/selectionMode.ts";
import { createTextAnchorReader } from "#/components/editor/textAnchors.ts";
import type {
	CanvasTool as Tool,
	useCanvasGestures,
} from "#/components/editor/useCanvasGestures.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import { screenAt } from "#/engine/view-projection.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";
import { shapeOutline } from "#/footprint/outline.ts";

const selectionIcons: Record<Exclude<SelectionMode, "replace">, typeof Plus> = {
	add: Plus,
	remove: Minus,
	toggle: Diff,
};

interface CanvasOverlayProps {
	cameraView: CanvasView;
	tool: Tool;
	shapes: EditorShape[];
	selected: EditorShape[];
	selectedSymbol: EditorSymbol | undefined;
	selectedChild: SymbolChild | undefined;
	handles: { shape: EditorShape; handle: ResizeHandle }[];
	guideCenter: Point | null;
	canvasArea: RefObject<HTMLElement | null>;
	connectionHover: Point | null;
	marquee: ReturnType<typeof useCanvasGestures>["marquee"];
	/** Height of the surface items on these layers lie on in a view turned in 3D. */
	layerHeight?: (layers: readonly FootprintLayer[]) => number;
	placementPreview?: EditorShape | null;
}

/** An item's outline as the turned view shows it, or nothing when part of it is behind the camera. */
function projectedOutline(
	view: Viewer2DSnapshot,
	shape: EditorShape,
	height: number,
) {
	const points = shapeOutline(shape).map((corner) =>
		screenAt(view, corner, height),
	);
	return points.every((point) => point !== null)
		? points.map((point) => `${point.x},${point.y}`).join(" ")
		: undefined;
}

export const CanvasOverlay = memo(function CanvasOverlay({
	cameraView,
	tool,
	shapes,
	selected,
	selectedSymbol,
	selectedChild,
	handles,
	guideCenter,
	canvasArea,
	connectionHover,
	marquee,
	layerHeight,
	placementPreview,
}: CanvasOverlayProps) {
	const view = useSyncExternalStore(
		cameraView.subscribe,
		cameraView.getSnapshot,
		cameraView.getSnapshot,
	);
	const [readTextAnchors] = useState(createTextAnchorReader);
	const textAnchors = useMemo(
		() => readTextAnchors(shapes, selected),
		[readTextAnchors, shapes, selected],
	);
	const heightOf = (shape: EditorShape) =>
		layerHeight?.(shapeLayers(shape)) ?? 0;
	const turned = view?.projection !== undefined;
	return (
		<>
			{view && (
				<div
					className="pointer-events-none absolute inset-0 z-2 overflow-hidden"
					aria-hidden="true"
					// Handles and guides follow the camera on every frame.
					data-shortcut-mutations="ignore"
				>
					{!turned && (
						<RulerPositionGuide
							view={view}
							guideCenter={guideCenter}
							canvasArea={canvasArea}
						/>
					)}
					{turned && (
						<svg
							className="absolute inset-0 size-full overflow-visible"
							data-testid="board-outlines"
							aria-hidden="true"
						>
							{placementPreview && (
								<polygon
									data-testid="board-placement"
									points={projectedOutline(
										view,
										placementPreview,
										heightOf(placementPreview),
									)}
									fill={
										darkSchematicTheme.appearance[shapeLayer(placementPreview)]
									}
									fillOpacity={0.4}
									stroke={
										darkSchematicTheme.appearance[shapeLayer(placementPreview)]
									}
									strokeWidth={1}
								/>
							)}
							{selected.map((shape) => (
								<polygon
									key={shape.id}
									data-testid="board-selection"
									data-shape-id={shape.id}
									points={projectedOutline(view, shape, heightOf(shape))}
									className="fill-accent/15 stroke-accent"
									strokeWidth={1.5}
								/>
							))}
						</svg>
					)}
					{connectionHover &&
						tool === "wire" &&
						(() => {
							const point = screenAt(view, connectionHover);
							if (!point) return null;
							return (
								<span
									data-testid="wire-connection"
									className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent"
									style={{ left: point.x, top: point.y }}
								/>
							);
						})()}

					{selectedSymbol &&
						selectedChild &&
						(() => {
							const bounds = shapeBounds(
								symbolChildWorld(selectedSymbol, selectedChild.shape),
							);
							const topLeft = screenAt(view, {
								x: bounds.minX,
								y: bounds.maxY,
							});
							const bottomRight = screenAt(view, {
								x: bounds.maxX,
								y: bounds.minY,
							});
							if (!topLeft || !bottomRight) return null;
							return (
								<span
									data-testid="symbol-child-selection"
									className="absolute border border-dashed border-accent"
									style={{
										left: topLeft.x - 3,
										top: topLeft.y - 3,
										width: bottomRight.x - topLeft.x + 6,
										height: bottomRight.y - topLeft.y + 6,
									}}
								/>
							);
						})()}
					{!turned && <SymbolAnchors view={view} shapes={shapes} />}
					{textAnchors.map((anchor) => {
						const owner =
							turned &&
							selected.find((shape) => String(shape.id) === anchor.key);
						const point = screenAt(view, anchor, owner ? heightOf(owner) : 0);
						if (!point) return null;
						return (
							<span
								key={anchor.key}
								data-testid="text-anchor"
								data-anchor-id={anchor.key}
								className="pointer-events-none absolute z-1 size-[5px] -translate-x-1/2 -translate-y-1/2 text-accent drop-shadow-[0_0_1px_var(--color-paper)] before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-current after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-current"
								style={{ left: point.x, top: point.y }}
							/>
						);
					})}
					{handles.map(({ shape, handle }) => {
						const point = screenAt(view, handle, heightOf(shape));
						if (!point) return null;
						return (
							<span
								key={`${shape.id}:${handle.id}`}
								className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 border border-accent bg-paper"
								data-testid="resize-handle"
								data-shape-id={shape.id}
								data-handle={handle.id}
								style={{ left: point.x, top: point.y }}
							/>
						);
					})}
				</div>
			)}
			{marquee && (
				<div
					className={`pointer-events-none absolute z-2 border ${
						marquee.mode === "window"
							? "border-select-window bg-select-window-tint"
							: "border-dashed border-select-crossing bg-select-crossing-tint"
					}`}
					data-testid="selection-rectangle"
					data-selection-mode={marquee.mode}
					data-selection-action={marquee.selection}
					aria-hidden="true"
					style={{
						left: Math.min(marquee.start.x, marquee.end.x),
						top: Math.min(marquee.start.y, marquee.end.y),
						width: Math.abs(marquee.end.x - marquee.start.x),
						height: Math.abs(marquee.end.y - marquee.start.y),
					}}
				/>
			)}
			{marquee &&
				marquee.selection !== "replace" &&
				(() => {
					const Icon = selectionIcons[marquee.selection];
					return (
						<span
							data-testid="selection-action"
							data-selection-action={marquee.selection}
							aria-hidden="true"
							className="pointer-events-none absolute z-3 rounded-sm border border-line bg-raised p-0.5 text-fg shadow-panel"
							style={{ left: marquee.end.x + 14, top: marquee.end.y + 14 }}
						>
							<Icon className="size-3" strokeWidth={2.5} />
						</span>
					);
				})()}
		</>
	);
});
