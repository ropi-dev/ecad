import { Minus, Plus } from "lucide-react";
import { MAX_ZOOM, MIN_ZOOM } from "../../engine/navigation";
import type { GerberViewerHandle } from "../viewer/types/GerberViewerHandle";

export function GerberFooter({
	enabled,
	zoom,
	resetView,
	zoomView,
}: Pick<GerberViewerHandle, "resetView" | "zoomView"> & {
	enabled: boolean;
	zoom: number;
}) {
	if (!enabled) return null;
	return (
		<footer>
			<div
				className="view-controls"
				data-view-controls
				role="toolbar"
				aria-label="View controls"
			>
				<button
					type="button"
					disabled={zoom <= MIN_ZOOM}
					title="Zoom out (-)"
					aria-label="Zoom out"
					onClick={() => zoomView(1 / 1.25)}
				>
					<Minus size={16} />
				</button>
				<button
					type="button"
					disabled={zoom >= MAX_ZOOM}
					title="Zoom in (+)"
					aria-label="Zoom in"
					onClick={() => zoomView(1.25)}
				>
					<Plus size={16} />
				</button>
				<button
					type="button"
					className="zoom-level"
					title="Reset to 100% (0)"
					aria-label="Reset zoom to 100%"
					onClick={resetView}
				>
					{Math.round(zoom * 100)}%
				</button>
			</div>
		</footer>
	);
}
