import { MAX_ZOOM, MIN_ZOOM } from "#/engine/navigation.ts";
import type { GerberViewerHandle } from "../viewer/types/GerberViewerHandle";
import { ZoomControls } from "../viewer/ZoomControls";

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
				<ZoomControls
					zoom={zoomView}
					fit={resetView}
					canZoomOut={zoom > MIN_ZOOM}
					canZoomIn={zoom < MAX_ZOOM}
					fitClassName="zoom-level"
					fitLabel="Reset zoom to 100%"
					fitTitle="Reset to 100% (0)"
				>
					{Math.round(zoom * 100)}%
				</ZoomControls>
			</div>
		</footer>
	);
}
