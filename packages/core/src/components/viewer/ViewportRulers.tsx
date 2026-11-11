import {
	type Ref,
	useCallback,
	useId,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	RULER_BAND as BAND,
	createTickLayer,
	type TickLayer,
} from "#/components/viewer/rulerTickLayer.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import { rulerTicks } from "#/engine/ruler.ts";
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

/**
 * Rulers along the top and right of a top view, and the paper under it.
 *
 * React renders the frame, which changes only with the viewport size. The
 * ticks and the paper follow the camera on every frame, so they are placed
 * directly: a pan slides the laid out ticks with a compositor transform, and
 * a zoom lays them out again without a React render. A view always gets the
 * same ticks, however it was reached, so positions read from them repeat.
 */
export function ViewportRulers({
	ref,
	gridBounds,
	unit = "mm",
}: {
	ref: Ref<ViewportRulersHandle>;
	gridBounds?: Bounds;
	unit?: "mm" | "mil";
}) {
	const descriptionId = useId();
	const [size, setSize] = useState<{ width: number; height: number }>();
	const latest = useRef<RulerView>(undefined);
	/** The view the ticks are laid out for. */
	const anchor = useRef<RulerView>(undefined);
	const horizontalTicks = useRef<SVGSVGElement>(null);
	const verticalTicks = useRef<SVGSVGElement>(null);
	const paperElement = useRef<HTMLDivElement>(null);
	const layers = useRef<{
		horizontal: SVGSVGElement;
		vertical: SVGSVGElement;
		x: TickLayer;
		y: TickLayer;
	}>(undefined);
	const settings = useRef({ unit, bounds: gridBounds });
	settings.current = { unit, bounds: gridBounds };
	const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
	useLayoutEffect(() => () => clearTimeout(settle.current), []);

	/** Lays the ticks and the paper out for `view`; false before the frame exists. */
	const layout = useCallback((view: RulerView) => {
		const horizontal = horizontalTicks.current;
		const vertical = verticalTicks.current;
		if (!horizontal || !vertical) return false;
		if (
			layers.current?.horizontal !== horizontal ||
			layers.current.vertical !== vertical
		)
			layers.current = {
				horizontal,
				vertical,
				x: createTickLayer(horizontal, "x"),
				y: createTickLayer(vertical, "y"),
			};
		const { camera, viewport } = view;
		const { unit, bounds } = settings.current;
		layers.current.x.layout(
			rulerTicks(
				camera.x,
				camera.scale,
				viewport.width + 2 * OVERSCAN,
				false,
				unit,
			),
			-OVERSCAN,
		);
		layers.current.y.layout(
			rulerTicks(
				camera.y,
				camera.scale,
				viewport.height + 2 * OVERSCAN,
				true,
				unit,
			),
			-OVERSCAN,
		);
		if (paperElement.current && bounds) {
			setStyle(
				paperElement.current,
				"width",
				`${(bounds.maxX - bounds.minX) * camera.scale}px`,
			);
			setStyle(
				paperElement.current,
				"height",
				`${(bounds.maxY - bounds.minY) * camera.scale}px`,
			);
		}
		anchor.current = view;
		return true;
	}, []);

	/** Moves the ticks and the paper to the latest view. */
	const place = useCallback(() => {
		const view = latest.current;
		if (!view) return;
		let offset = anchor.current && slide(anchor.current, view);
		if (!offset) {
			if (!layout(view)) return;
			offset = { x: 0, y: 0, sharp: true };
		}
		clearTimeout(settle.current);
		if (!offset.sharp)
			settle.current = setTimeout(() => {
				if (latest.current && layout(latest.current)) place();
			}, SETTLE_MS);
		const { horizontal, vertical } = layers.current ?? {};
		if (horizontal)
			setStyle(horizontal, "transform", `translateX(${offset.x}px)`);
		if (vertical) setStyle(vertical, "transform", `translateY(${offset.y}px)`);
		const paper = settings.current.bounds;
		if (paperElement.current && paper) {
			const { camera, viewport } = view;
			setStyle(
				paperElement.current,
				"transform",
				`translate(${
					viewport.width / 2 + (paper.minX - camera.x) * camera.scale
				}px, ${viewport.height / 2 + (camera.y - paper.maxY) * camera.scale}px)`,
			);
		}
	}, [layout]);

	useImperativeHandle(
		ref,
		() => ({
			update: (next) => {
				const previous = latest.current?.viewport;
				latest.current = next;
				const { width, height } = next.viewport;
				if (previous?.width !== width || previous.height !== height)
					setSize({ width, height });
				place();
			},
		}),
		[place],
	);
	const paperMinX = gridBounds?.minX;
	const paperMaxX = gridBounds?.maxX;
	const paperMinY = gridBounds?.minY;
	const paperMaxY = gridBounds?.maxY;
	// The frame, the unit or the paper changed: lay everything out again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the values are read through refs
	useLayoutEffect(() => {
		anchor.current = undefined;
		place();
	}, [size, unit, paperMinX, paperMaxX, paperMinY, paperMaxY, place]);

	if (!size) return null;
	const { width, height } = size;
	// The viewport draws the grid dots. The paper and the ticks move on their
	// own compositor layers; the bands and corner stay still. Nothing under
	// these elements holds or moves a button, so shortcut hints ignore their
	// changes.
	return (
		<>
			{gridBounds && (
				// Clip, not hide: a sheet larger than the view must not make any
				// ancestor scrollable.
				<div
					className="pointer-events-none absolute inset-0 z-0 overflow-clip"
					aria-hidden="true"
					data-shortcut-mutations="ignore"
				>
					<div
						ref={paperElement}
						data-testid="viewport-paper"
						className="absolute top-0 left-0 will-change-transform"
						style={{ backgroundColor: darkSchematicTheme.paper }}
					/>
				</div>
			)}
			<div
				className="pointer-events-none absolute inset-0 z-2 overflow-clip [&_line]:stroke-1 [&_text]:fill-current [&_text]:font-mono [&_text]:text-[10px] [&_text]:tabular-nums text-fg-muted [&_line]:stroke-ruler-tick [&_.ruler-band]:fill-ruler [&_.ruler-edge]:stroke-line [&_svg]:absolute"
				role="img"
				aria-label={`Drawing rulers in ${unit === "mil" ? "mils" : "millimetres"}`}
				aria-describedby={descriptionId}
				data-shortcut-mutations="ignore"
			>
				<span id={descriptionId} className="sr-only">
					Coordinates in {unit === "mil" ? "mils" : "millimetres"}. X increases
					to the right; Y increases upward.
				</span>
				<div
					className="absolute top-0 left-0 overflow-clip"
					style={{ width: Math.max(width - BAND, 0), height: BAND + 1 }}
				>
					<svg
						className="top-0 left-0"
						width={width}
						height={BAND + 1}
						aria-hidden="true"
					>
						<path className="ruler-band" d={`M0 0H${width}V${BAND}H0Z`} />
						<path className="ruler-edge fill-none" d={`M0 ${BAND}H${width}`} />
					</svg>
					<svg
						ref={horizontalTicks}
						className="top-0 will-change-transform"
						style={{ left: -OVERSCAN }}
						width={width + 2 * OVERSCAN}
						height={BAND}
						viewBox={`${-OVERSCAN} 0 ${width + 2 * OVERSCAN} ${BAND}`}
						aria-hidden="true"
					/>
				</div>
				<div
					className="absolute top-0 overflow-clip"
					style={{ left: width - BAND - 1, width: BAND + 1, height }}
				>
					<svg
						className="top-0 left-0"
						width={BAND + 1}
						height={height}
						aria-hidden="true"
					>
						<path className="ruler-band" d={`M1 0H${BAND + 1}V${height}H1Z`} />
						<path className="ruler-edge fill-none" d={`M1 ${BAND}V${height}`} />
					</svg>
					<svg
						ref={verticalTicks}
						className="left-0 will-change-transform"
						style={{ top: -OVERSCAN }}
						width={BAND + 1}
						height={height + 2 * OVERSCAN}
						viewBox={`0 ${-OVERSCAN} ${BAND + 1} ${height + 2 * OVERSCAN}`}
						aria-hidden="true"
					/>
					<svg
						className="top-0 left-0"
						width={BAND + 1}
						height={BAND}
						aria-hidden="true"
					>
						<path className="ruler-band" d={`M1 0H${BAND + 1}V${BAND}H1Z`} />
						<text x={BAND / 2 + 1} y="15" textAnchor="middle">
							{unit}
						</text>
					</svg>
				</div>
			</div>
		</>
	);
}
