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
import { Diff, Minus, Plus } from "lucide-react";
import { memo, useMemo, useState, useSyncExternalStore } from "react";
import type { CanvasView } from "#/components/editor/canvasView.ts";
import type { SelectionMode } from "#/components/editor/selectionMode.ts";
import { createTextAnchorReader } from "#/components/editor/textAnchors.ts";
import type {
	CanvasTool as Tool,
	useCanvasGestures,
} from "#/components/editor/useCanvasGestures.ts";
import { worldToScreen } from "#/engine/camera.ts";

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
	connectionHover: Point | null;
	marquee: ReturnType<typeof useCanvasGestures>["marquee"];
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
	connectionHover,
	marquee,
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
	const rulerPosition =
		guideCenter && view
			? worldToScreen(
					guideCenter,
					view.camera,
					view.viewport.width,
					view.viewport.height,
				)
			: null;

	return (
		<>
			{view && (
				<div
					className="pointer-events-none absolute inset-0 z-2 overflow-hidden"
					aria-hidden="true"
					// Handles and guides follow the camera on every frame.
					data-shortcut-mutations="ignore"
				>
					{rulerPosition && (
						<svg
							data-testid="ruler-position-guide"
							aria-hidden="true"
							className="absolute inset-0 size-full stroke-fg-muted/60 stroke-1"
						>
							{rulerPosition.y >= 24 &&
								rulerPosition.y <= view.viewport.height && (
									<line
										data-axis="y"
										x1={view.viewport.width - 24}
										y1={rulerPosition.y}
										x2={view.viewport.width}
										y2={rulerPosition.y}
									/>
								)}
							{rulerPosition.x >= 0 &&
								rulerPosition.x < view.viewport.width - 24 && (
									<line
										data-axis="x"
										x1={rulerPosition.x}
										y1={0}
										x2={rulerPosition.x}
										y2={24}
									/>
								)}
						</svg>
					)}
					{connectionHover &&
						tool === "wire" &&
						(() => {
							const point = worldToScreen(
								connectionHover,
								view.camera,
								view.viewport.width,
								view.viewport.height,
							);
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
							const topLeft = worldToScreen(
								{ x: bounds.minX, y: bounds.maxY },
								view.camera,
								view.viewport.width,
								view.viewport.height,
							);
							const bottomRight = worldToScreen(
								{ x: bounds.maxX, y: bounds.minY },
								view.camera,
								view.viewport.width,
								view.viewport.height,
							);
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
					{textAnchors.map((anchor) => {
						const point = worldToScreen(
							anchor,
							view.camera,
							view.viewport.width,
							view.viewport.height,
						);
						return (
							<span
								key={anchor.key}
								data-testid="text-anchor"
								data-anchor-id={anchor.key}
								className="pointer-events-none absolute z-1 size-[9px] -translate-x-1/2 -translate-y-1/2 text-accent drop-shadow-[0_0_1px_var(--color-paper)] before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-current after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-current"
								style={{ left: point.x, top: point.y }}
							/>
						);
					})}
					{handles.map(({ shape, handle }) => {
						const point = worldToScreen(
							handle,
							view.camera,
							view.viewport.width,
							view.viewport.height,
						);
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
