import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	Minus,
	Plus,
} from "lucide-react";
import { MAX_ZOOM, MIN_ZOOM } from "../../engine/navigation";
import type { GerberViewerHandle } from "../viewer/types/GerberViewerHandle";

export function GerberFooter({
	enabled,
	zoom,
	resetView,
	zoomView,
	panView,
}: GerberViewerHandle & { enabled: boolean; zoom: number }) {
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
					disabled={!enabled || zoom <= MIN_ZOOM}
					title="Zoom out (-)"
					aria-label="Zoom out"
					onClick={() => zoomView(1 / 1.25)}
				>
					<Minus size={16} />
				</button>
				<button
					type="button"
					disabled={!enabled || zoom >= MAX_ZOOM}
					title="Zoom in (+)"
					aria-label="Zoom in"
					onClick={() => zoomView(1.25)}
				>
					<Plus size={16} />
				</button>
				<button
					type="button"
					disabled={!enabled}
					className="zoom-level"
					title="Reset to 100% (0)"
					aria-label="Reset zoom to 100%"
					onClick={resetView}
				>
					{Math.round(zoom * 100)}%
				</button>
				<span className="controls-divider" />
				<button
					type="button"
					disabled={!enabled}
					title="Pan left"
					aria-label="Pan left"
					onClick={() => panView(-80, 0)}
				>
					<ArrowLeft size={16} />
				</button>
				<button
					type="button"
					disabled={!enabled}
					title="Pan up"
					aria-label="Pan up"
					onClick={() => panView(0, -80)}
				>
					<ArrowUp size={16} />
				</button>
				<button
					type="button"
					disabled={!enabled}
					title="Pan down"
					aria-label="Pan down"
					onClick={() => panView(0, 80)}
				>
					<ArrowDown size={16} />
				</button>
				<button
					type="button"
					disabled={!enabled}
					title="Pan right"
					aria-label="Pan right"
					onClick={() => panView(80, 0)}
				>
					<ArrowRight size={16} />
				</button>
			</div>
			{enabled && (
				<p className="navigation-hint">
					Drag or two-finger scroll to pan · Pinch to zoom · 0 to reset
				</p>
			)}
		</footer>
	);
}
