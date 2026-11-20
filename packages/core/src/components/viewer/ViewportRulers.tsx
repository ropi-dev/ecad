import {
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	onSettled,
	Show,
} from "solid-js";
import {
	RULER_BAND as BAND,
	createTickLayer,
	type TickLayer,
} from "#/components/viewer/rulerTickLayer.ts";
import { type GridUnit, rulerTicks } from "#/engine/ruler.ts";
import type { Bounds, Camera } from "#/engine/types.ts";

interface RulerView {
	camera: Camera;
	viewport: { width: number; height: number };
}

export interface ViewportRulersHandle {
	update: (view: RulerView) => void;
}

/** How long a pan rests before blurred labels are laid out at whole pixels. */
const SETTLE_MS = 150;
/**
 * Pixels of ticks laid out beyond each edge, for a pan to slide into view.
 * Labelled ticks are at most 500 pixels apart, so two are always laid out.
 */
const OVERSCAN = 512;

/**
 * How far the ticks laid out for `anchor` have to move to show `view`, or
 * null when they have to be laid out again.
 */
function slide(anchor: RulerView, view: RulerView) {
	if (
		anchor.camera.scale !== view.camera.scale ||
		anchor.viewport.width !== view.viewport.width ||
		anchor.viewport.height !== view.viewport.height
	)
		return null;
	const x = (anchor.camera.x - view.camera.x) * view.camera.scale;
	const y = (view.camera.y - anchor.camera.y) * view.camera.scale;
	if (Math.abs(x) > OVERSCAN || Math.abs(y) > OVERSCAN) return null;
	// Labels moved by part of a device pixel are resampled and look soft.
	const ratio = window.devicePixelRatio || 1;
	const whole = (value: number) =>
		Math.abs(value * ratio - Math.round(value * ratio)) < 1e-3;
	return { x, y, sharp: whole(x) && whole(y) };
}

/** Writes a style property only when it changes, so an idle frame mutates nothing. */
function setStyle(
	element: HTMLElement | SVGElement,
	property: "transform" | "width" | "height",
	value: string,
) {
	if (element.style[property] !== value) element.style[property] = value;
}

const sameBounds = (a: Bounds | undefined, b: Bounds | undefined) =>
	a === b ||
	(a !== undefined &&
		b !== undefined &&
		a.minX === b.minX &&
		a.maxX === b.maxX &&
		a.minY === b.minY &&
		a.maxY === b.maxY);

/**
 * Rulers along the bottom and right of a top view, and the paper under it.
 *
 * Solid renders the frame, which changes only with the viewport size. The
 * ticks and the paper follow the camera on every frame, so they are placed
 * directly: a pan slides the laid out ticks with a compositor transform, and
 * a zoom lays them out again without touching the reactive graph. A view
 * always gets the same ticks, however it was reached, so positions read from
 * them repeat.
 */
export function ViewportRulers(props: {
	ref: (handle: ViewportRulersHandle) => void;
	gridBounds?: Bounds;
	unit?: GridUnit;
}) {
	const descriptionId = createUniqueId();
	const [size, setSize] = createSignal<{ width: number; height: number }>();
	const unit = createMemo(() => props.unit ?? "mm");
	const bounds = createMemo(() => props.gridBounds, { equals: sameBounds });
	let latest: RulerView | undefined;
	let shownUnit: GridUnit = "mm";
	let paper: Bounds | undefined;
	/** The view the ticks are laid out for. */
	let anchor: RulerView | undefined;
	let horizontalTicks: SVGSVGElement | undefined;
	let verticalTicks: SVGSVGElement | undefined;
	let paperElement: HTMLDivElement | undefined;
	let layers:
		| {
				horizontal: SVGSVGElement;
				vertical: SVGSVGElement;
				x: TickLayer;
				y: TickLayer;
		  }
		| undefined;
	let settle: ReturnType<typeof setTimeout> | undefined;
	onSettled(() => () => clearTimeout(settle));

	/** Lays the ticks and the paper out for `view`; false before the frame exists. */
	const layout = (view: RulerView) => {
		const horizontal = horizontalTicks;
		const vertical = verticalTicks;
		if (!horizontal || !vertical) return false;
		if (layers?.horizontal !== horizontal || layers.vertical !== vertical)
			layers = {
				horizontal,
				vertical,
				x: createTickLayer(horizontal, "x"),
				y: createTickLayer(vertical, "y"),
			};
		const { camera, viewport } = view;
		layers.x.layout(
			rulerTicks(
				camera.x,
				camera.scale,
				viewport.width + 2 * OVERSCAN,
				false,
				shownUnit,
			),
			-OVERSCAN,
		);
		layers.y.layout(
			rulerTicks(
				camera.y,
				camera.scale,
				viewport.height + 2 * OVERSCAN,
				true,
				shownUnit,
			),
			-OVERSCAN,
		);
		if (paperElement && paper) {
			setStyle(
				paperElement,
				"width",
				`${(paper.maxX - paper.minX) * camera.scale}px`,
			);
			setStyle(
				paperElement,
				"height",
				`${(paper.maxY - paper.minY) * camera.scale}px`,
			);
		}
		anchor = view;
		return true;
	};

	/** Moves the ticks and the paper to the latest view. */
	const place = () => {
		const view = latest;
		if (!view) return;
		let offset = anchor && slide(anchor, view);
		if (!offset) {
			if (!layout(view)) return;
			offset = { x: 0, y: 0, sharp: true };
		}
		clearTimeout(settle);
		if (!offset.sharp)
			settle = setTimeout(() => {
				if (latest && layout(latest)) place();
			}, SETTLE_MS);
		if (layers) {
			setStyle(layers.horizontal, "transform", `translateX(${offset.x}px)`);
			setStyle(layers.vertical, "transform", `translateY(${offset.y}px)`);
		}
		if (paperElement && paper) {
			const { camera, viewport } = view;
			setStyle(
				paperElement,
				"transform",
				`translate(${
					viewport.width / 2 + (paper.minX - camera.x) * camera.scale
				}px, ${viewport.height / 2 + (camera.y - paper.maxY) * camera.scale}px)`,
			);
		}
	};

	props.ref({
		update: (next) => {
			const previous = latest?.viewport;
			latest = next;
			const { width, height } = next.viewport;
			if (previous?.width !== width || previous.height !== height)
				setSize({ width, height });
			place();
		},
	});
	// The frame, the unit or the paper changed: lay everything out again.
	createEffect(
		() => [size(), unit(), bounds()] as const,
		([, nextUnit, nextBounds]) => {
			shownUnit = nextUnit;
			paper = nextBounds;
			anchor = undefined;
			place();
		},
	);

	const width = () => size()?.width ?? 0;
	const height = () => size()?.height ?? 0;
	const unitName = () => (unit() === "mm" ? "millimetres" : "mils");
	// The viewport draws the grid dots. The paper and the ticks move on their
	// own compositor layers; the bands and corner stay still. Nothing under
	// these elements holds or moves a button, so shortcut hints ignore their
	// changes.
	return (
		<Show when={size()}>
			<Show when={props.gridBounds}>
				{/* Clip, not hide: a sheet larger than the view must not make any
				ancestor scrollable. */}
				<div
					class="pointer-events-none absolute inset-0 z-0 overflow-clip"
					aria-hidden="true"
					data-shortcut-mutations="ignore"
				>
					<div
						ref={paperElement}
						data-testid="viewport-paper"
						class="absolute top-0 left-0 bg-paper will-change-transform"
					/>
				</div>
			</Show>
			<div
				class="pointer-events-none absolute inset-0 z-2 overflow-clip [&_line]:stroke-1 [&_text]:fill-current [&_text]:font-mono [&_text]:text-[10px] [&_text]:tabular-nums text-fg-muted [&_line]:stroke-ruler-tick [&_.ruler-band]:fill-ruler [&_.ruler-edge]:stroke-line [&_svg]:absolute"
				role="img"
				aria-label={`Drawing rulers in ${unitName()}`}
				aria-describedby={descriptionId}
				data-shortcut-mutations="ignore"
			>
				<span id={descriptionId} class="sr-only">
					Coordinates in {unitName()}. X increases to the right; Y increases
					upward.
				</span>
				<div
					class="absolute bottom-0 left-0 overflow-clip"
					style={{
						width: `${Math.max(width() - BAND, 0)}px`,
						height: `${BAND + 1}px`,
					}}
				>
					<svg
						class="top-0 left-0"
						width={width()}
						height={BAND + 1}
						aria-hidden="true"
					>
						<path class="ruler-band" d={`M0 1H${width()}V${BAND + 1}H0Z`} />
						<path class="ruler-edge fill-none" d={`M0 1H${width()}`} />
					</svg>
					<svg
						ref={horizontalTicks}
						class="top-0 will-change-transform"
						style={{ left: `${-OVERSCAN}px` }}
						width={width() + 2 * OVERSCAN}
						height={BAND + 1}
						viewBox={`${-OVERSCAN} 0 ${width() + 2 * OVERSCAN} ${BAND + 1}`}
						aria-hidden="true"
					/>
				</div>
				<div
					class="absolute top-0 overflow-clip"
					style={{
						left: `${width() - BAND - 1}px`,
						width: `${BAND + 1}px`,
						height: `${height()}px`,
					}}
				>
					<svg
						class="top-0 left-0"
						width={BAND + 1}
						height={height()}
						aria-hidden="true"
					>
						<path class="ruler-band" d={`M1 0H${BAND + 1}V${height()}H1Z`} />
						<path class="ruler-edge fill-none" d={`M1 0V${height() - BAND}`} />
					</svg>
					<svg
						ref={verticalTicks}
						class="left-0 will-change-transform"
						style={{ top: `${-OVERSCAN}px` }}
						width={BAND + 1}
						height={height() + 2 * OVERSCAN}
						viewBox={`0 ${-OVERSCAN} ${BAND + 1} ${height() + 2 * OVERSCAN}`}
						aria-hidden="true"
					/>
					<svg
						class="bottom-0 left-0"
						width={BAND + 1}
						height={BAND}
						aria-hidden="true"
					>
						<path class="ruler-band" d={`M1 0H${BAND + 1}V${BAND}H1Z`} />
						<text x={BAND / 2 + 1} y="15" text-anchor="middle">
							{unit() === "mm" ? "mm" : "mil"}
						</text>
					</svg>
				</div>
			</div>
		</Show>
	);
}
