import type { Viewer2DHandle } from "../viewer/types/Viewer2DHandle";
import { ViewControls3D } from "../viewer/ViewControls3D";

export function GerberFooter({
	enabled,
	resetView,
	zoomView,
}: Pick<Viewer2DHandle, "resetView" | "zoomView"> & { enabled: boolean }) {
	if (!enabled) return null;
	return (
		<ViewControls3D
			enabled={enabled}
			fit={resetView}
			zoom={zoomView}
			fitLabel="Fit drawing"
		/>
	);
}
