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
import { shapeLayer } from "@ecad/drawing-core/footprint/shapes.ts";
import { Dynamic } from "@solidjs/web";
import { createMemo, For, Show } from "solid-js";
import type { CanvasMarquee } from "#/components/editor/canvasDrag.ts";
import type { CanvasView } from "#/components/editor/canvasView.ts";
import { RulerPositionGuide } from "#/components/editor/RulerPositionGuide.tsx";
import { SymbolAnchors } from "#/components/editor/SymbolAnchors.tsx";
import type { SelectionMode } from "#/components/editor/selectionMode.ts";
import { createTextAnchorReader } from "#/components/editor/textAnchors.ts";
import type { CanvasTool as Tool } from "#/components/editor/useCanvasGestures.ts";
import { useCanvasProjection } from "#/components/editor/useCanvasProjection.ts";
import { Diff, type LucideIcon, Minus, Plus } from "#/components/ui/icons.tsx";
import { useSchematicTheme } from "#/settings/theme.ts";

const selectionIcons: Record<Exclude<SelectionMode, "replace">, LucideIcon> = {
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
	canvasArea: HTMLElement | null | undefined;
	connectionHover: Point | null;
	marquee: CanvasMarquee | null;
	placementPreview?: EditorShape | null;
	/** The board's layers replace the flat drawing, so selections show as outlines. */
	layered?: boolean;
}

const polygonPoints = (outline: readonly Point[] | null) =>
	outline?.map((point) => `${point.x},${point.y}`).join(" ");

const px = (value: number) => `${value}px`;

export function CanvasOverlay(props: CanvasOverlayProps) {
	const projection = useCanvasProjection(() => props.cameraView);
	const frame = createMemo(() => {
		const current = projection();
		const view = current && props.cameraView.getSnapshot();
		return current && view ? { projection: current, view } : null;
	});
	const readTextAnchors = createTextAnchorReader();
	const textAnchors = createMemo(() =>
		readTextAnchors(props.shapes, props.selected),
	);
	const layerColors = useSchematicTheme();
	return (
		<>
			<Show when={frame()}>
				{(frame) => {
					const turned = () => frame().projection.turned;
					const connection = createMemo(() =>
						props.connectionHover &&
						(props.tool === "wire" || props.tool === "track")
							? frame().projection.toScreen(props.connectionHover)
							: null,
					);
					const childBox = createMemo(() => {
						const symbol = props.selectedSymbol;
						const child = props.selectedChild;
						if (!symbol || !child) return null;
						const bounds = shapeBounds(symbolChildWorld(symbol, child.shape));
						const topLeft = frame().projection.toScreen({
							x: bounds.minX,
							y: bounds.maxY,
						});
						const bottomRight = frame().projection.toScreen({
							x: bounds.maxX,
							y: bounds.minY,
						});
						return topLeft && bottomRight ? { topLeft, bottomRight } : null;
					});
					return (
						<div
							class="pointer-events-none absolute inset-0 z-2 overflow-hidden"
							aria-hidden="true"
							// Handles and guides follow the camera on every frame.
							data-shortcut-mutations="ignore"
						>
							<Show when={!turned()}>
								<RulerPositionGuide
									view={frame().view}
									guideCenter={props.guideCenter}
									canvasArea={props.canvasArea}
								/>
							</Show>
							<Show when={turned() || props.layered}>
								<svg
									class="absolute inset-0 size-full overflow-visible"
									data-testid="board-outlines"
									aria-hidden="true"
								>
									<Show when={props.placementPreview}>
										{(preview) => (
											<polygon
												data-testid="board-placement"
												points={polygonPoints(
													frame().projection.screenOutline(preview()),
												)}
												fill={layerColors().appearance[shapeLayer(preview())]}
												fill-opacity={0.4}
												stroke={layerColors().appearance[shapeLayer(preview())]}
												stroke-width={1}
											/>
										)}
									</Show>
									<For each={props.selected} keyed={(shape) => shape.id}>
										{(shape) => (
											<polygon
												data-testid="board-selection"
												data-shape-id={shape().id}
												points={polygonPoints(
													frame().projection.screenOutline(shape()),
												)}
												class="fill-accent/15 stroke-accent"
												stroke-width={1.5}
											/>
										)}
									</For>
								</svg>
							</Show>
							<Show when={connection()}>
								{(point) => (
									<span
										data-testid="wire-connection"
										class="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent"
										style={{ left: px(point().x), top: px(point().y) }}
									/>
								)}
							</Show>
							<Show when={childBox()}>
								{(box) => (
									<span
										data-testid="symbol-child-selection"
										class="absolute border border-dashed border-accent"
										style={{
											left: px(box().topLeft.x - 3),
											top: px(box().topLeft.y - 3),
											width: px(box().bottomRight.x - box().topLeft.x + 6),
											height: px(box().bottomRight.y - box().topLeft.y + 6),
										}}
									/>
								)}
							</Show>
							<Show when={!turned()}>
								<SymbolAnchors view={frame().view} shapes={props.shapes} />
							</Show>
							<For each={textAnchors()} keyed={(anchor) => anchor.key}>
								{(anchor) => {
									const point = createMemo(() => {
										const { projection } = frame();
										const owner =
											projection.turned &&
											props.selected.find(
												(shape) => String(shape.id) === anchor().key,
											);
										return projection.toScreen(
											anchor(),
											owner ? projection.heightOf(owner) : 0,
										);
									});
									return (
										<Show when={point()}>
											{(point) => (
												<span
													data-testid="text-anchor"
													data-anchor-id={anchor().key}
													class="pointer-events-none absolute z-1 size-[5px] -translate-x-1/2 -translate-y-1/2 text-accent drop-shadow-[0_0_1px_var(--color-paper)] before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-current after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-current"
													style={{ left: px(point().x), top: px(point().y) }}
												/>
											)}
										</Show>
									);
								}}
							</For>
							<For
								each={props.handles}
								keyed={(item) => `${item.shape.id}:${item.handle.id}`}
							>
								{(item) => {
									const point = createMemo(() =>
										frame().projection.toScreen(
											item().handle,
											frame().projection.heightOf(item().shape),
										),
									);
									return (
										<Show when={point()}>
											{(point) => (
												<span
													class={[
														"absolute -translate-x-1/2 -translate-y-1/2 border border-accent bg-paper",
														item().handle.inserts
															? "size-2 rounded-full"
															: "size-2.5",
													]}
													data-testid="resize-handle"
													data-shape-id={item().shape.id}
													data-handle={item().handle.id}
													style={{ left: px(point().x), top: px(point().y) }}
												/>
											)}
										</Show>
									);
								}}
							</For>
						</div>
					);
				}}
			</Show>
			<Show when={props.marquee}>
				{(marquee) => (
					<div
						class={[
							"pointer-events-none absolute z-2 border",
							marquee().mode === "window"
								? "border-select-window bg-select-window-tint"
								: "border-dashed border-select-crossing bg-select-crossing-tint",
						]}
						data-testid="selection-rectangle"
						data-selection-mode={marquee().mode}
						data-selection-action={marquee().selection}
						aria-hidden="true"
						style={{
							left: px(Math.min(marquee().start.x, marquee().end.x)),
							top: px(Math.min(marquee().start.y, marquee().end.y)),
							width: px(Math.abs(marquee().end.x - marquee().start.x)),
							height: px(Math.abs(marquee().end.y - marquee().start.y)),
						}}
					/>
				)}
			</Show>
			<Show
				when={
					props.marquee && props.marquee.selection !== "replace"
						? { ...props.marquee, selection: props.marquee.selection }
						: null
				}
			>
				{(marquee) => (
					<span
						data-testid="selection-action"
						data-selection-action={marquee().selection}
						aria-hidden="true"
						class="pointer-events-none absolute z-3 rounded-sm border border-line bg-raised p-0.5 text-fg shadow-panel"
						style={{
							left: px(marquee().end.x + 14),
							top: px(marquee().end.y + 14),
						}}
					>
						<Dynamic
							component={selectionIcons[marquee().selection]}
							class="size-3"
							strokeWidth={2.5}
						/>
					</span>
				)}
			</Show>
		</>
	);
}
