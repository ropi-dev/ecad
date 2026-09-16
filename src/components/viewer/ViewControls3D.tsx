import { Box, Square } from "lucide-react";
import type { ReactNode } from "react";
import { MAX_ZOOM, MIN_ZOOM } from "#/engine/navigation";
import type { Viewer3DHandle } from "./types/Viewer3DHandle";
import { ZoomControls } from "./ZoomControls";

export function ViewControls3D({
	enabled,
	children,
	fitLabel = "Fit model",
	fit,
	zoom,
	zoomLevel,
	view,
	projection,
	toggleProjection,
}: Pick<Viewer3DHandle, "fit" | "zoom"> & {
	view?: Viewer3DHandle["view"];
	enabled: boolean;
	zoomLevel: number;
	projection: "perspective" | "orthographic";
	toggleProjection: () => void;
	children?: ReactNode;
	fitLabel?: string;
}) {
	const button =
		"flex h-10 min-w-10 items-center justify-center whitespace-nowrap rounded border border-white/20 px-2 text-xs text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-40";
	return (
		<div
			role="toolbar"
			aria-label={view ? "3D view controls" : "View controls"}
			className="absolute bottom-4 left-1/2 z-10 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap justify-center gap-0.5 rounded-lg border border-white/20 bg-slate-900/95 p-1 shadow-lg sm:gap-1"
		>
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
			{children}
		</div>
	);
}
