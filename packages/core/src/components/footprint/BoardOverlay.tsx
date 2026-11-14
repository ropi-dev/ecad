import {
	type EditorShape,
	type ResizeHandle,
	shapeBounds,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import { shapeLayer } from "@ecad/drawing-core/footprint/shapes.ts";
import { Diff, Minus, Plus } from "lucide-react";
import { memo, useSyncExternalStore } from "react";
import type { CanvasMarquee } from "#/components/editor/canvasDrag.ts";
import type {
	CanvasProjection,
	CanvasView,
} from "#/components/editor/canvasView.ts";

const selectionIcons = { add: Plus, remove: Minus, toggle: Diff } as const;
const circleSegments = 48;

function outline(shape: EditorShape): { points: Point[]; closed: boolean } {
	const { x, y, width, height, rotation } = shape;
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	const at = (u: number, v: number) => ({
		x: x + u * cos - v * sin,
		y: y + u * sin + v * cos,
	});
	const right = width / 2;
	const top = height / 2;
	if (shape.kind === "line")
		return { points: [at(-right, 0), at(right, 0)], closed: false };
	if (shape.kind === "circle")
		return {
			points: Array.from({ length: circleSegments }, (_, index) => {
				const angle = (2 * Math.PI * index) / circleSegments;
				return at(right * Math.cos(angle), right * Math.sin(angle));
			}),
			closed: true,
		};
	if (shape.kind === "triangle")
		return {
			points: [at(-right, -top), at(right, -top), at(0, top)],
			closed: true,
		};
	if (shape.kind === "rectangle")
		return {
			points: [
				at(-right, -top),
				at(right, -top),
				at(right, top),
				at(-right, top),
			],
			closed: true,
		};
	const bounds = shapeBounds(shape);
	return {
		points: [
			{ x: bounds.minX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.maxY },
			{ x: bounds.minX, y: bounds.maxY },
		],
		closed: true,
	};
}

function screenPath(
	projection: CanvasProjection,
	points: readonly Point[],
	plane: number,
	closed: boolean,
) {
	const screen = points.map((point) => projection.toScreen(point, plane));
	if (screen.some((point) => !point)) return null;
	return `${screen
		.map((point, index) => `${index ? "L" : "M"}${point?.x} ${point?.y}`)
		.join("")}${closed ? "Z" : ""}`;
}

const shapePlane = (projection: CanvasProjection, shape: EditorShape) =>
	projection.planeOf(shape) ?? projection.layerPlane(shapeLayer(shape));

export const BoardOverlay = memo(function BoardOverlay({
	cameraView,
	selected,
	handles,
	preview,
	marquee,
}: {
	cameraView: CanvasView;
	selected: readonly EditorShape[];
	handles: readonly { shape: EditorShape; handle: ResizeHandle }[];
	preview: EditorShape | null;
	marquee: CanvasMarquee | null;
}) {
	const projection = useSyncExternalStore(
		cameraView.subscribe,
		cameraView.getProjection,
		cameraView.getProjection,
	);
	if (!projection?.tilted) return null;
	const path = (shape: EditorShape) => {
		const { points, closed } = outline(shape);
		return screenPath(
			projection,
			points,
			shapePlane(projection, shape),
			closed,
		);
	};
	const previewPath = preview && path(preview);
	const area = marquee?.area;
	const marqueePath =
		area &&
		screenPath(
			projection,
			[
				{ x: area.minX, y: area.minY },
				{ x: area.maxX, y: area.minY },
				{ x: area.maxX, y: area.maxY },
				{ x: area.minX, y: area.maxY },
			],
			marquee.plane,
			true,
		);
	const SelectionIcon =
		marquee && marquee.selection !== "replace"
			? selectionIcons[marquee.selection]
			: null;
	return (
		<div
			className="pointer-events-none absolute inset-0 z-2 overflow-hidden"
			aria-hidden="true"
			data-shortcut-mutations="ignore"
		>
			<svg className="absolute inset-0 size-full" role="presentation">
				{selected.map((shape) => {
					const d = path(shape);
					return (
						d && (
							<path
								key={shape.id}
								d={d}
								data-testid="board-selection"
								data-shape-id={shape.id}
								className="fill-accent-tint-strong stroke-accent"
								strokeWidth={1.5}
								strokeLinejoin="round"
							/>
						)
					);
				})}
				{previewPath && (
					<path
						d={previewPath}
						data-testid="board-placement-preview"
						className="fill-accent-tint stroke-accent"
						strokeWidth={1.5}
						strokeDasharray="4 3"
					/>
				)}
				{marquee && marqueePath && (
					<path
						d={marqueePath}
						data-testid="selection-rectangle"
						data-selection-mode={marquee.mode}
						data-selection-action={marquee.selection}
						className={
							marquee.mode === "window"
								? "fill-select-window-tint stroke-select-window"
								: "fill-select-crossing-tint stroke-select-crossing"
						}
						strokeDasharray={marquee.mode === "window" ? undefined : "4 3"}
					/>
				)}
			</svg>
			{handles.map(({ shape, handle }) => {
				const point = projection.toScreen(
					handle,
					shapePlane(projection, shape),
				);
				return (
					point && (
						<span
							key={`${shape.id}:${handle.id}`}
							className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 border border-accent bg-paper"
							data-testid="resize-handle"
							data-shape-id={shape.id}
							data-handle={handle.id}
							style={{ left: point.x, top: point.y }}
						/>
					)
				);
			})}
			{marquee && SelectionIcon && (
				<span
					data-testid="selection-action"
					data-selection-action={marquee.selection}
					className="absolute z-3 rounded-sm border border-line bg-raised p-0.5 text-fg shadow-panel"
					style={{ left: marquee.end.x + 14, top: marquee.end.y + 14 }}
				>
					<SelectionIcon className="size-3" strokeWidth={2.5} />
				</span>
			)}
		</div>
	);
});
