import { Box, Download, Scan, Square } from "lucide-react";
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
			<Download size={18} aria-hidden="true" />
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
					{trailing}
				</ToolbarDock>
			</ViewExportContext>
		);
	return (
		<ToolbarDock label={label} scrollable={false}>
			{zoomControls}
			{(toggleProjection || view || pngButton) && <ToolbarSeparator />}
			{viewControls}
			{pngButton}
			{children && <ToolbarSeparator />}
			{children}
		</ToolbarDock>
	);
}
