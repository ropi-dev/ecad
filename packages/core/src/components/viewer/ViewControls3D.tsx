import { Box, Download, Scan, Square } from "lucide-react";
import { type ReactNode, useState } from "react";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { MAX_ZOOM, MIN_ZOOM } from "#/engine/navigation.ts";
import {
	MAX_PHYSICAL_ZOOM,
	MIN_PHYSICAL_ZOOM,
} from "#/engine/scene-viewport.ts";
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
	actualSize,
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
	actualSize?: () => void;
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
		<>
			<ZoomControls
				zoom={zoom}
				fit={fit}
				enabled={enabled}
				canZoomIn={zoomLevel < (actualSize ? MAX_PHYSICAL_ZOOM : MAX_ZOOM)}
				canZoomOut={zoomLevel > (actualSize ? MIN_PHYSICAL_ZOOM : MIN_ZOOM)}
				buttonClassName={button}
				fitClassName={`${button} min-w-14 tabular-nums`}
				fitLabel={fitLabel}
				fitTitle={fitLabel}
			>
				{actualSize ? (
					<Scan size={16} aria-hidden="true" />
				) : (
					`${Math.round(zoomLevel * 100)}%`
				)}
			</ZoomControls>
			{actualSize && (
				<TooltipButton
					type="button"
					className={`${button} min-w-14 tabular-nums`}
					disabled={!enabled}
					tooltip="Actual size, based on reported display dimensions"
					aria-label="Actual size"
					onClick={actualSize}
				>
					{Math.round(zoomLevel * 100)}%
				</TooltipButton>
			)}
		</>
	);
	const viewControls = (
		<>
			{toggleProjection && (
				<TooltipButton
					type="button"
					className={button}
					disabled={!enabled}
					aria-label="Orthographic camera"
					aria-pressed={projection === "orthographic"}
					tooltip={
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
				</TooltipButton>
			)}
			{view && (
				<>
					<TooltipButton
						type="button"
						className={button}
						disabled={!enabled}
						tooltip="Isometric view"
						onClick={() => view("iso")}
					>
						Iso
					</TooltipButton>
					<TooltipButton
						type="button"
						className={button}
						disabled={!enabled}
						tooltip="Top view"
						onClick={() => view("top")}
					>
						Top
					</TooltipButton>
					<TooltipButton
						type="button"
						className={button}
						disabled={!enabled}
						tooltip="Front view"
						onClick={() => view("front")}
					>
						Front
					</TooltipButton>
				</>
			)}
			{exportPng && (
				<TooltipButton
					type="button"
					className={`${button} gap-1.5`}
					disabled={!enabled || exporting}
					aria-label="Export PNG"
					aria-busy={exporting}
					tooltip="Export PNG"
					onClick={exportPng}
				>
					<Download size={18} aria-hidden="true" />
					{exporting ? "Exporting…" : "PNG"}
				</TooltipButton>
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
