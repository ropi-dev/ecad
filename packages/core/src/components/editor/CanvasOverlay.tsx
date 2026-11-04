import { memo, useMemo, useState, useSyncExternalStore } from "react";
import type { CanvasView } from "#/components/editor/canvasView.ts";
import { createTextAnchorReader } from "#/components/editor/textAnchors.ts";
import type {
	CanvasTool as Tool,
	useCanvasGestures,
} from "#/components/editor/useCanvasGestures.ts";
import type {
	EditorSymbol,
	ResizeHandle,
	SymbolChild,
} from "#/drawing/shapes.ts";
import {
	type EditorShape,
	shapeBounds,
	symbolChildWorld,
} from "#/drawing/shapes.ts";
import type { Point } from "#/drawing/types.ts";
import { worldToScreen } from "#/engine/camera.ts";

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
				>
					{rulerPosition && (
						<svg
							data-testid="ruler-position-guide"
							aria-hidden="true"
							className="absolute inset-0 size-full stroke-gray-400/60 stroke-1"
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
									className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#e8b77e]"
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
									className="absolute border border-dashed border-[#e8b77e]"
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
								className="pointer-events-none absolute z-1 size-[9px] -translate-x-1/2 -translate-y-1/2 text-[#e8b77e] drop-shadow-[0_0_1px_#19212e] before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-current after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-current"
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
								className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 border border-[#e8b77e] bg-[#19212e]"
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
							? "border-[#60a5fa] bg-[#60a5fa25]"
							: "border-dashed border-[#4ade80] bg-[#4ade8025]"
					}`}
					data-testid="selection-rectangle"
					data-selection-mode={marquee.mode}
					aria-hidden="true"
					style={{
						left: Math.min(marquee.start.x, marquee.end.x),
						top: Math.min(marquee.start.y, marquee.end.y),
						width: Math.abs(marquee.end.x - marquee.start.x),
						height: Math.abs(marquee.end.y - marquee.start.y),
					}}
				/>
			)}
		</>
	);
});
