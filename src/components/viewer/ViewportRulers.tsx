import { type Ref, useImperativeHandle, useState } from "react";
import type { Camera } from "#/engine";
import { rulerTicks } from "#/engine/ruler";

interface RulerView {
	camera: Camera;
	viewport: { width: number; height: number };
}

export interface ViewportRulersHandle {
	update: (view: RulerView) => void;
}

export function ViewportRulers({ ref }: { ref: Ref<ViewportRulersHandle> }) {
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
	const horizontal = rulerTicks(camera.x, camera.scale, width);
	const vertical = rulerTicks(camera.y, camera.scale, height, true);
	return (
		<>
			<svg
				className="viewport-grid"
				width={width}
				height={height}
				aria-hidden="true"
			>
				{horizontal.map((tick) => (
					<line
						key={tick.value}
						x1={tick.position}
						x2={tick.position}
						y1="0"
						y2={height}
						data-major={tick.label !== undefined}
					/>
				))}
				{vertical.map((tick) => (
					<line
						key={tick.value}
						x1="0"
						x2={width}
						y1={tick.position}
						y2={tick.position}
						data-major={tick.label !== undefined}
					/>
				))}
			</svg>
			<svg
				className="viewport-rulers"
				width={width}
				height={height}
				role="img"
				aria-label="Drawing rulers in millimetres"
			>
				<title>
					Board coordinates in millimetres. X increases to the right; Y
					increases upward.
				</title>
				<path
					className="ruler-background"
					d={`M0 0H${width}V24H24V${height}H0Z`}
				/>
				<path className="ruler-border" d={`M24 ${height}V24H${width}`} />
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
							x1={tick.label === undefined ? 19 : 15}
							x2="24"
						/>
						{tick.label !== undefined && (
							<text
								transform={`translate(11 ${tick.position - 3}) rotate(-90)`}
							>
								{tick.label}
							</text>
						)}
					</g>
				))}
				<path className="ruler-background" d="M0 0H24V24H0Z" />
				<text x="12" y="15" textAnchor="middle">
					mm
				</text>
			</svg>
		</>
	);
}
