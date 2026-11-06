import {
	type Ref,
	useCallback,
	useId,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
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

const BAND = 24;
/** How long a pan rests before blurred labels are laid out at whole pixels. */
const SETTLE_MS = 150;

/**
 * Ticks are laid out for the view at the last anchor, one viewport beyond
 * each edge. A pan slides them with a compositor transform and lays them out
 * again only when it nears the end of that range, so most frames repaint
 * nothing here.
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
	if (Math.abs(x) > view.viewport.width || Math.abs(y) > view.viewport.height)
		return null;
	// Labels moved by part of a device pixel are resampled and look soft.
	const ratio = window.devicePixelRatio || 1;
	const whole = (value: number) =>
		Math.abs(value * ratio - Math.round(value * ratio)) < 1e-3;
	return { x, y, sharp: whole(x) && whole(y) };
}

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
	const [anchor, setAnchor] = useState<RulerView>();
	const latest = useRef<RulerView>(undefined);
	const horizontalTicks = useRef<SVGSVGElement>(null);
	const verticalTicks = useRef<SVGSVGElement>(null);
	const paperElement = useRef<HTMLDivElement>(null);
	const bounds = useRef(gridBounds);
	bounds.current = gridBounds;
	const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
	useLayoutEffect(() => () => clearTimeout(settle.current), []);
	/** Moves the ticks and paper to the latest view; false when it needs a layout. */
	const place = useCallback((base: RulerView | undefined) => {
		const view = latest.current;
		if (!view || !base) return false;
		const offset = slide(base, view);
		if (!offset) return false;
		clearTimeout(settle.current);
		if (!offset.sharp)
			settle.current = setTimeout(() => setAnchor(latest.current), SETTLE_MS);
		if (horizontalTicks.current)
			horizontalTicks.current.style.transform = `translateX(${offset.x}px)`;
		if (verticalTicks.current)
			verticalTicks.current.style.transform = `translateY(${offset.y}px)`;
		const paper = bounds.current;
		if (paperElement.current && paper) {
			const { camera, viewport } = view;
			paperElement.current.style.transform = `translate(${
				viewport.width / 2 + (paper.minX - camera.x) * camera.scale
			}px, ${viewport.height / 2 + (camera.y - paper.maxY) * camera.scale}px)`;
		}
		return true;
	}, []);
	const anchored = useRef(anchor);
	anchored.current = anchor;
	useImperativeHandle(
		ref,
		() => ({
			update: (next) => {
				latest.current = next;
				if (!place(anchored.current)) setAnchor(next);
			},
		}),
		[place],
	);
	useLayoutEffect(() => {
		place(anchor);
	});
	if (!anchor) return null;
	const {
		camera,
		viewport: { width, height },
	} = anchor;
	const horizontal = rulerTicks(
		camera.x,
		camera.scale,
		width * 3,
		false,
		unit,
	).map((tick) => ({ ...tick, position: tick.position - width }));
	const vertical = rulerTicks(
		camera.y,
		camera.scale,
		height * 3,
		true,
		unit,
	).map((tick) => ({ ...tick, position: tick.position - height }));
	const paper = gridBounds && {
		width: (gridBounds.maxX - gridBounds.minX) * camera.scale,
		height: (gridBounds.maxY - gridBounds.minY) * camera.scale,
	};
	// The viewport draws the grid dots. The paper and the ticks move on their
	// own compositor layers; the bands and corner stay still.
	return (
		<>
			{paper && (
				// Clip, not hide: a sheet larger than the view must not make any
				// ancestor scrollable.
				<div
					className="pointer-events-none absolute inset-0 z-0 overflow-clip"
					aria-hidden="true"
				>
					<div
						ref={paperElement}
						data-testid="viewport-paper"
						className="absolute top-0 left-0 will-change-transform"
						style={{
							width: paper.width,
							height: paper.height,
							backgroundColor: darkSchematicTheme.paper,
						}}
					/>
				</div>
			)}
			<div
				className="pointer-events-none absolute inset-0 z-2 overflow-clip [&_line]:stroke-1 [&_text]:fill-current [&_text]:[font-family:ui-monospace,monospace] [&_text]:text-[10px] [&_text]:tabular-nums text-[#9ba7b8] [&_line]:stroke-[#657183] [&_.ruler-band]:fill-[#191c22] [&_.ruler-edge]:stroke-[#414955] [&_svg]:absolute"
				role="img"
				aria-label={`Drawing rulers in ${unit === "mil" ? "mils" : "millimetres"}`}
				aria-describedby={descriptionId}
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
						style={{ left: -width }}
						width={width * 3}
						height={BAND}
						viewBox={`${-width} 0 ${width * 3} ${BAND}`}
						aria-hidden="true"
					>
						<path
							className="fill-none stroke-[#657183] stroke-1"
							d={horizontal
								.filter((tick) => tick.label === undefined)
								.map((tick) => `M${tick.position} 19V${BAND}`)
								.join("")}
						/>
						{horizontal.map(
							(tick) =>
								tick.label !== undefined && (
									<g key={tick.value} data-axis="x" data-value={tick.value}>
										<line
											x1={tick.position}
											x2={tick.position}
											y1={15}
											y2={BAND}
										/>
										<text x={tick.position + 3} y="11">
											{tick.label}
										</text>
									</g>
								),
						)}
					</svg>
				</div>
				<div
					className="absolute top-0 overflow-clip"
					style={{ left: width - BAND - 1, width: BAND + 1, height }}
				>
					<svg
						className="top-0 left-0"
						width={BAND + 1}
						height={height}
						viewBox={`${width - BAND - 1} 0 ${BAND + 1} ${height}`}
						aria-hidden="true"
					>
						<path
							className="ruler-band"
							d={`M${width - BAND} 0H${width}V${height}H${width - BAND}Z`}
						/>
						<path
							className="ruler-edge fill-none"
							d={`M${width - BAND} ${BAND}V${height}`}
						/>
					</svg>
					<svg
						ref={verticalTicks}
						className="left-0 will-change-transform"
						style={{ top: -height }}
						width={BAND + 1}
						height={height * 3}
						viewBox={`${width - BAND - 1} ${-height} ${BAND + 1} ${height * 3}`}
						aria-hidden="true"
					>
						<path
							className="fill-none stroke-[#657183] stroke-1"
							d={vertical
								.filter((tick) => tick.label === undefined)
								.map(
									(tick) => `M${width - BAND} ${tick.position}H${width - 19}`,
								)
								.join("")}
						/>
						{vertical.map(
							(tick) =>
								tick.label !== undefined && (
									<g key={tick.value} data-axis="y" data-value={tick.value}>
										<line
											y1={tick.position}
											y2={tick.position}
											x1={width - BAND}
											x2={width - 15}
										/>
										<text
											transform={`translate(${width - 11} ${tick.position + 3}) rotate(90)`}
										>
											{tick.label}
										</text>
									</g>
								),
						)}
					</svg>
					<svg
						className="top-0 left-0"
						width={BAND + 1}
						height={BAND}
						viewBox={`${width - BAND - 1} 0 ${BAND + 1} ${BAND}`}
						aria-hidden="true"
					>
						<path
							className="ruler-band"
							d={`M${width - BAND} 0H${width}V${BAND}H${width - BAND}Z`}
						/>
						<text x={width - 12} y="15" textAnchor="middle">
							{unit}
						</text>
					</svg>
				</div>
			</div>
		</>
	);
}
