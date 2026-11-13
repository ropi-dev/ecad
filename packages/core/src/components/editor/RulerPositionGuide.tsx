import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import type { RefObject } from "react";
import { useCursorPoint } from "#/components/editor/useCursorPoint.ts";
import { RULER_BAND } from "#/components/viewer/rulerTickLayer.ts";
import { worldToScreen } from "#/engine/camera.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";

export function RulerPositionGuide({
	view,
	guideCenter,
	canvasArea,
}: {
	view: Viewer2DSnapshot;
	guideCenter: Point | null;
	canvasArea: RefObject<HTMLElement | null>;
}) {
	const cursor = useCursorPoint(canvasArea);
	const { width, height } = view.viewport;
	const position = guideCenter
		? worldToScreen(guideCenter, view.camera, width, height)
		: cursor;
	if (!position) return null;
	return (
		<svg
			data-testid="ruler-position-guide"
			data-source={guideCenter ? "object" : "cursor"}
			aria-hidden="true"
			className="absolute inset-0 size-full stroke-fg-muted/60 stroke-1"
		>
			{position.y >= 0 && position.y <= height - RULER_BAND && (
				<line
					data-axis="y"
					x1={width - RULER_BAND}
					y1={position.y}
					x2={width}
					y2={position.y}
				/>
			)}
			{position.x >= 0 && position.x < width - RULER_BAND && (
				<line
					data-axis="x"
					x1={position.x}
					y1={height - RULER_BAND}
					x2={position.x}
					y2={height}
				/>
			)}
		</svg>
	);
}
