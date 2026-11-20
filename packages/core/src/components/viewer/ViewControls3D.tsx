import type { JSX } from "@solidjs/web";
import { children, createContext, For, Show, useContext } from "solid-js";
import { Box, Download, Scan, Square } from "#/components/ui/icons.tsx";
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

interface ViewExport {
	readonly exportPng?: () => void;
	readonly exporting: boolean;
	readonly enabled: boolean;
}

const ViewExportContext = createContext<ViewExport>({
	exporting: false,
	enabled: false,
});

/**
 * Grouped toolbars leave PNG export to their tools, so an editor can list it
 * beside its own export actions.
 */
export const useViewExport = (): ViewExport => useContext(ViewExportContext);

const VIEW_DIRECTIONS = [
	["iso", "Iso", "Isometric view"],
	["top", "Top", "Top view"],
	["front", "Front", "Front view"],
] as const;

export function ViewControls3D(
	props: Pick<Viewer3DHandle, "fit" | "zoom"> & {
		view?: Viewer3DHandle["view"];
		enabled: boolean;
		/**
		 * Editor layout for the 2D canvas: tools first, then zoom, then `trailing`,
		 * in one scrolling row. Camera and view buttons are not shown.
		 */
		grouped?: boolean;
		scrollable?: boolean;
		label?: string;
		zoomLevel: number;
		absoluteZoom?: boolean;
		actualSize?: () => void;
		projection: "perspective" | "orthographic";
		toggleProjection?: () => void;
		children?: JSX.Element;
		trailing?: JSX.Element;
		fitLabel?: string;
		exportPng?: () => void;
		exporting?: boolean;
	},
) {
	const button = viewControlButtonClassName;
	const exporting = () => props.exporting ?? false;
	const fitLabel = () => props.fitLabel ?? "Fit model";
	const percent = () => `${Math.round(props.zoomLevel * 100)}%`;
	const viewExport: ViewExport = {
		get exportPng() {
			return props.exportPng;
		},
		get exporting() {
			return exporting();
		},
		get enabled() {
			return props.enabled;
		},
	};
	const label = () =>
		props.label ?? (props.view ? "3D view controls" : "View controls");
	const zoomControls = () => (
		<ZoomControls
			zoom={(factor) => props.zoom(factor)}
			fit={() => props.fit()}
			enabled={props.enabled}
			canZoomIn={
				props.zoomLevel < (props.absoluteZoom ? MAX_PHYSICAL_ZOOM : MAX_ZOOM)
			}
			canZoomOut={
				props.zoomLevel > (props.absoluteZoom ? MIN_PHYSICAL_ZOOM : MIN_ZOOM)
			}
			buttonClassName={button}
			fitClassName={`${button} min-w-14 tabular-nums`}
			fitLabel={fitLabel()}
			fitTitle={fitLabel()}
			extra={
				<Show when={props.actualSize}>
					<TooltipButton
						type="button"
						class={`${button} min-w-14 tabular-nums`}
						disabled={!props.enabled}
						tooltip="Actual size, based on reported display dimensions"
						aria-label="Actual size"
						onClick={() => props.actualSize?.()}
					>
						{percent()}
					</TooltipButton>
				</Show>
			}
		>
			<Show when={props.actualSize} fallback={percent()}>
				<Scan size={16} aria-hidden="true" />
			</Show>
		</ZoomControls>
	);
	const viewControls = () => (
		<>
			<Show when={props.toggleProjection}>
				<TooltipButton
					type="button"
					class={button}
					disabled={!props.enabled}
					aria-label="Orthographic camera"
					aria-pressed={props.projection === "orthographic" ? "true" : "false"}
					tooltip={
						props.projection === "orthographic"
							? "Switch to perspective camera"
							: "Switch to orthographic camera"
					}
					onClick={() => props.toggleProjection?.()}
				>
					<Show
						when={props.projection === "orthographic"}
						fallback={<Box size={18} aria-hidden="true" />}
					>
						<Square size={18} aria-hidden="true" />
					</Show>
				</TooltipButton>
			</Show>
			<Show when={props.view}>
				{/* biome-ignore lint/a11y/useSemanticElements: a fieldset adds form semantics to plain view buttons */}
				<div
					role="group"
					aria-label="View direction"
					class="flex shrink-0 items-center gap-0.5"
				>
					<For each={VIEW_DIRECTIONS}>
						{([direction, text, tooltip]) => (
							<TooltipButton
								type="button"
								class={`${button} px-2.5`}
								disabled={!props.enabled}
								tooltip={tooltip}
								onClick={() => props.view?.(direction)}
							>
								{text}
							</TooltipButton>
						)}
					</For>
				</div>
			</Show>
		</>
	);
	return (
		<Show
			when={props.grouped}
			fallback={
				<ToolbarDock label={label()} scrollable={props.scrollable ?? false}>
					{zoomControls()}
					<Show when={props.toggleProjection || props.view}>
						<ToolbarSeparator />
					</Show>
					{viewControls()}
					<Show when={props.exportPng}>
						<ToolbarSeparator />
						<TooltipButton
							type="button"
							class={button}
							disabled={!props.enabled || exporting()}
							aria-label="Export PNG"
							aria-busy={exporting() ? "true" : "false"}
							tooltip="Export PNG"
							onClick={() => props.exportPng?.()}
						>
							<Download size={16} aria-hidden="true" />
							{exporting() ? "Exporting…" : "PNG"}
						</TooltipButton>
					</Show>
					<SeparatedExtra>{props.children}</SeparatedExtra>
				</ToolbarDock>
			}
		>
			<ViewExportContext value={viewExport}>
				<ToolbarDock label={label()}>
					{props.children}
					<ToolbarSeparator />
					{zoomControls()}
					{props.trailing}
				</ToolbarDock>
			</ViewExportContext>
		</Show>
	);
}

function SeparatedExtra(props: { children?: JSX.Element }) {
	const extra = children(() => props.children);
	return (
		<>
			<Show when={extra.toArray().length > 0}>
				<ToolbarSeparator />
			</Show>
			{extra()}
		</>
	);
}
