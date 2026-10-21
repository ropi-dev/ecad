import { Box, Download, Scan, Square } from "lucide-react";
import { type ReactNode, useState } from "react";
import { MAX_ZOOM, MIN_ZOOM } from "#/engine/navigation.ts";
import { ToolbarGroup, ToolbarGroups } from "./ToolbarGroup";
import type { Viewer3DHandle } from "./types/Viewer3DHandle";
import { ZoomControls } from "./ZoomControls";

export { viewControlButtonClassName } from "./viewControlStyles";

import { viewControlButtonClassName } from "./viewControlStyles";

export function ViewControls3D({
	enabled,
	grouped = false,
	children,
	fitLabel = "Fit model",
	fit,
	zoom,
	zoomLevel,
	view,
	projection,
	toggleProjection,
	exportPng,
	exporting = false,
}: Pick<Viewer3DHandle, "fit" | "zoom"> & {
	view?: Viewer3DHandle["view"];
	enabled: boolean;
	grouped?: boolean;
	zoomLevel: number;
	projection: "perspective" | "orthographic";
	toggleProjection?: () => void;
	children?: ReactNode;
	fitLabel?: string;
	exportPng?: () => void;
	exporting?: boolean;
}) {
	const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
	const button = viewControlButtonClassName;
	const zoomControls = (
		<ZoomControls
			zoom={zoom}
			fit={fit}
			enabled={enabled}
			canZoomIn={zoomLevel < MAX_ZOOM}
			canZoomOut={zoomLevel > MIN_ZOOM}
			buttonClassName={button}
			fitClassName={`${button} min-w-14 tabular-nums`}
			fitLabel={fitLabel}
			fitTitle={`${fitLabel} (F6 or double-click the mouse wheel)`}
		>
			{Math.round(zoomLevel * 100)}%
		</ZoomControls>
	);
	const viewControls = (
		<>
			{toggleProjection && (
				<button
					type="button"
					className={button}
					disabled={!enabled}
					aria-label="Orthographic camera"
					aria-pressed={projection === "orthographic"}
					title={
						projection === "orthographic"
							? "Switch to perspective camera"
							: "Switch to orthographic camera"
					}
					onClick={toggleProjection}
				>
					{projection === "orthographic" ? (
						<Square size={18} aria-hidden="true" />
					) : (
						<Box size={18} aria-hidden="true" />
					)}
				</button>
			)}
			{view && (
				<>
					<button
						type="button"
						className={button}
						disabled={!enabled}
						onClick={() => view("iso")}
					>
						Iso
					</button>
					<button
						type="button"
						className={button}
						disabled={!enabled}
						onClick={() => view("top")}
					>
						Top
					</button>
					<button
						type="button"
						className={button}
						disabled={!enabled}
						onClick={() => view("front")}
					>
						Front
					</button>
				</>
			)}
			{exportPng && (
				<button
					type="button"
					className={`${button} gap-1.5`}
					disabled={!enabled || exporting}
					aria-label="Export PNG"
					aria-busy={exporting}
					title="Download the current scene as a PNG image"
					onClick={exportPng}
				>
					<Download size={18} aria-hidden="true" />
					{exporting ? "Exporting…" : "PNG"}
				</button>
			)}
		</>
	);
	return (
		<ToolbarGroups panelHost={panelHost}>
			<div
				ref={setPanelHost}
				role="toolbar"
				aria-label={view ? "3D view controls" : "View controls"}
				className="absolute bottom-4 left-1/2 z-10 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-lg border border-white/20 bg-slate-900/95 p-1 shadow-lg"
			>
				<div
					className={`flex gap-0.5 sm:gap-1 ${grouped ? "touch-pan-x flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:thin] [&_button]:shrink-0" : "flex-wrap justify-center"}`}
				>
					{zoomControls}
					{grouped ? (
						<ToolbarGroup label="View tools" icon={Scan} disabled={!enabled}>
							{viewControls}
						</ToolbarGroup>
					) : (
						viewControls
					)}
					{children}
				</div>
			</div>
		</ToolbarGroups>
	);
}
