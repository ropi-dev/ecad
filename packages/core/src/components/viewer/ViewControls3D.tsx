import { Box, Download, Scan, Sparkles, Square } from "lucide-react";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
	ToolbarDock,
	ToolbarSeparator,
} from "#/components/viewer/ToolbarGroup.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import type { Viewer3DHandle } from "#/components/viewer/types/Viewer3DHandle.ts";
import { ZoomControls } from "#/components/viewer/ZoomControls.tsx";
import { MAX_ZOOM, MIN_ZOOM } from "#/engine/navigation.ts";
import {
	MAX_PHYSICAL_ZOOM,
	MIN_PHYSICAL_ZOOM,
} from "#/engine/scene-viewport.ts";

export { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";

import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";

const ViewExportContext = createContext<{
	exportPng?: () => void;
	exporting: boolean;
	enabled: boolean;
}>({ exporting: false, enabled: false });

/**
 * Grouped toolbars leave PNG export to their tools, so an editor can list it
 * beside its own export actions.
 */
export const useViewExport = () => useContext(ViewExportContext);

export function ViewControls3D({
	enabled,
	grouped = false,
	children,
	trailing,
	label: controlsLabel,
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
	antialias,
	toggleAntialias,
}: Pick<Viewer3DHandle, "fit" | "zoom"> & {
	view?: Viewer3DHandle["view"];
	enabled: boolean;
	/**
	 * Editor layout for the 2D canvas: tools first, then zoom, then `trailing`,
	 * in one scrolling row. Camera and view buttons are not shown.
	 */
	grouped?: boolean;
	label?: string;
	zoomLevel: number;
	actualSize?: () => void;
	projection: "perspective" | "orthographic";
	toggleProjection?: () => void;
	children?: ReactNode;
	trailing?: ReactNode;
	fitLabel?: string;
	exportPng?: () => void;
	exporting?: boolean;
	antialias?: boolean;
	toggleAntialias?: () => void;
}) {
	const button = viewControlButtonClassName;
	const viewExport = useMemo(
		() => ({ exportPng, exporting, enabled }),
		[exportPng, exporting, enabled],
	);
	const zoomControls = (
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
			extra={
				actualSize && (
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
				)
			}
		>
			{actualSize ? (
				<Scan size={16} aria-hidden="true" />
			) : (
				`${Math.round(zoomLevel * 100)}%`
			)}
		</ZoomControls>
	);
	const antialiasButton = toggleAntialias && (
		<TooltipButton
			type="button"
			className={button}
			disabled={!enabled}
			aria-label="Antialiasing"
			aria-pressed={antialias}
			tooltip={
				antialias
					? "Turn off antialiasing for faster drawing"
					: "Turn on antialiasing for smoother edges"
			}
			onClick={toggleAntialias}
		>
			<Sparkles size={18} aria-hidden="true" />
		</TooltipButton>
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
				// biome-ignore lint/a11y/useSemanticElements: a fieldset adds form semantics to plain view buttons
				<div
					role="group"
					aria-label="View direction"
					className="flex shrink-0 items-center gap-0.5"
				>
					{(
						[
							["iso", "Iso", "Isometric view"],
							["top", "Top", "Top view"],
							["front", "Front", "Front view"],
						] as const
					).map(([direction, label, tooltip]) => (
						<TooltipButton
							key={direction}
							type="button"
							className={`${button} px-2.5`}
							disabled={!enabled}
							tooltip={tooltip}
							onClick={() => view(direction)}
						>
							{label}
						</TooltipButton>
					))}
				</div>
			)}
		</>
	);
	const pngButton = exportPng && (
		<TooltipButton
			type="button"
			className={button}
			disabled={!enabled || exporting}
			aria-label="Export PNG"
			aria-busy={exporting}
			tooltip="Export PNG"
			onClick={exportPng}
		>
			<Download size={16} aria-hidden="true" />
			{exporting ? "Exporting…" : "PNG"}
		</TooltipButton>
	);
	const label = controlsLabel ?? (view ? "3D view controls" : "View controls");
	if (grouped)
		return (
			<ViewExportContext value={viewExport}>
				<ToolbarDock label={label}>
					{children}
					<ToolbarSeparator />
					{zoomControls}
					{antialiasButton}
					{trailing}
				</ToolbarDock>
			</ViewExportContext>
		);
	return (
		<ToolbarDock label={label} scrollable={false}>
			{zoomControls}
			{antialiasButton}
			{(toggleProjection || view) && <ToolbarSeparator />}
			{viewControls}
			{pngButton && <ToolbarSeparator />}
			{pngButton}
			{children && <ToolbarSeparator />}
			{children}
		</ToolbarDock>
	);
}
