import { type Ref, useId, useImperativeHandle, useState } from "react";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import type { Camera } from "#/engine/index.ts";
import { gridLayers, rulerTicks } from "#/engine/ruler.ts";
import type { Bounds } from "#/engine/types.ts";

interface RulerView {
	camera: Camera;
	viewport: { width: number; height: number };
}

export interface ViewportRulersHandle {
	update: (view: RulerView) => void;
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
	const gridMaskId = useId();
	const gridPatternId = useId();
	const [view, setView] = useState<RulerView>();
	useImperativeHandle(
		ref,
		() => ({
			update: (next) =>
				setView((previous) =>
					previous?.camera.x === next.camera.x &&
					previous.camera.y === next.camera.y &&
					previous.camera.scale === next.camera.scale &&
					previous.viewport.width === next.viewport.width &&
					previous.viewport.height === next.viewport.height
						? previous
						: next,
				),
		}),
		[],
	);
	if (!view) return null;
	const {
		camera,
		viewport: { width, height },
	} = view;
	const horizontal = rulerTicks(
		camera.x,
		camera.scale,
		width,
		false,
		unit,
	).filter((tick) => tick.position < width - 24);
	const vertical = rulerTicks(
		camera.y,
		camera.scale,
		height,
		true,
		unit,
	).filter((tick) => tick.position >= 24);
	const layers = gridLayers(camera.scale, unit);
	return (
		<>
			<svg
				data-testid="viewport-grid"
				className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
				width={width}
				height={height}
				aria-hidden="true"
			>
				<defs>
					{layers.map(({ spacing }, index) => {
						const pixels = spacing.minor * camera.scale;
						return (
							<pattern
								key={spacing.minor}
								id={`${gridPatternId}-${index}`}
								patternUnits="userSpaceOnUse"
								x={width / 2 - camera.x * camera.scale - pixels / 2}
								y={height / 2 + camera.y * camera.scale - pixels / 2}
								width={pixels}
								height={pixels}
							>
								<circle
									cx={pixels / 2}
									cy={pixels / 2}
									r={1}
									fill={darkSchematicTheme.grid}
								/>
							</pattern>
						);
					})}
				</defs>
				{gridBounds && (
					<defs>
						<mask
							id={gridMaskId}
							maskUnits="userSpaceOnUse"
							x="0"
							y="0"
							width={width}
							height={height}
							style={{ maskType: "alpha" }}
						>
							<rect width={width} height={height} fill="white" opacity={0.3} />
							<rect
								x={width / 2 + (gridBounds.minX - camera.x) * camera.scale}
								y={height / 2 + (camera.y - gridBounds.maxY) * camera.scale}
								width={(gridBounds.maxX - gridBounds.minX) * camera.scale}
								height={(gridBounds.maxY - gridBounds.minY) * camera.scale}
								fill="white"
							/>
						</mask>
					</defs>
				)}
				{gridBounds && (
					<rect
						data-testid="viewport-paper"
						x={width / 2 + (gridBounds.minX - camera.x) * camera.scale}
						y={height / 2 + (camera.y - gridBounds.maxY) * camera.scale}
						width={(gridBounds.maxX - gridBounds.minX) * camera.scale}
						height={(gridBounds.maxY - gridBounds.minY) * camera.scale}
						fill={darkSchematicTheme.paper}
					/>
				)}
				<g mask={gridBounds ? `url(#${gridMaskId})` : undefined}>
					{layers.map(({ spacing, opacity }, index) => (
						<rect
							key={spacing.minor}
							width={width}
							height={height}
							fill={`url(#${gridPatternId}-${index})`}
							opacity={opacity}
						/>
					))}
				</g>
			</svg>
			<svg
				className="pointer-events-none absolute inset-0 z-2 overflow-hidden [&_line]:stroke-1 [&_text]:fill-current [&_text]:[font-family:ui-monospace,monospace] [&_text]:text-[10px] [&_text]:tabular-nums text-[#9ba7b8] [&_line]:stroke-[#657183] [&_.ruler-band]:fill-[#191c22] [&_.ruler-edge]:stroke-[#414955]"
				width={width}
				height={height}
				role="img"
				aria-label={`Drawing rulers in ${unit === "mil" ? "mils" : "millimetres"}`}
			>
				<title>
					Coordinates in {unit === "mil" ? "mils" : "millimetres"}. X increases
					to the right; Y increases upward.
				</title>
				<path
					className="ruler-band"
					d={`M0 0H${width}V${height}H${width - 24}V24H0Z`}
				/>
				<path
					className="ruler-edge fill-none"
					d={`M0 24H${width - 24}V${height}`}
				/>
				{horizontal.map((tick) => (
					<g key={tick.value} data-axis="x" data-value={tick.value}>
						<line
							x1={tick.position}
							x2={tick.position}
							y1={tick.label === undefined ? 19 : 15}
							y2="24"
						/>
						{tick.label !== undefined && (
							<text x={tick.position + 3} y="11">
								{tick.label}
							</text>
						)}
					</g>
				))}
				{vertical.map((tick) => (
					<g key={tick.value} data-axis="y" data-value={tick.value}>
						<line
							y1={tick.position}
							y2={tick.position}
							x1={width - 24}
							x2={width - (tick.label === undefined ? 19 : 15)}
						/>
						{tick.label !== undefined && (
							<text
								transform={`translate(${width - 11} ${tick.position + 3}) rotate(90)`}
							>
								{tick.label}
							</text>
						)}
					</g>
				))}
				<path
					className="ruler-band"
					d={`M${width - 24} 0H${width}V24H${width - 24}Z`}
				/>
				<text x={width - 12} y="15" textAnchor="middle">
					{unit}
				</text>
			</svg>
		</>
	);
}
