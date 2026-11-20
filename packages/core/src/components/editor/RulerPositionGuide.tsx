import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import { createMemo, Show } from "solid-js";
import { useCursorPoint } from "#/components/editor/useCursorPoint.ts";
import { RULER_BAND } from "#/components/viewer/rulerTickLayer.ts";
import { worldToScreen } from "#/engine/camera.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";

export function RulerPositionGuide(props: {
	view: Viewer2DSnapshot;
	guideCenter: Point | null;
	canvasArea: HTMLElement | null | undefined;
}) {
	const cursor = useCursorPoint(() => props.canvasArea);
	const position = createMemo(() => {
		const { width, height } = props.view.viewport;
		return props.guideCenter
			? worldToScreen(props.guideCenter, props.view.camera, width, height)
			: cursor();
	});
	const width = () => props.view.viewport.width;
	const height = () => props.view.viewport.height;
	return (
		<Show when={position()}>
			{(position) => (
				<svg
					data-testid="ruler-position-guide"
					data-source={props.guideCenter ? "object" : "cursor"}
					aria-hidden="true"
					class="absolute inset-0 size-full stroke-fg-muted/60 stroke-1"
				>
					<Show
						when={position().y >= 0 && position().y <= height() - RULER_BAND}
					>
						<line
							data-axis="y"
							x1={width() - RULER_BAND}
							y1={position().y}
							x2={width()}
							y2={position().y}
						/>
					</Show>
					<Show when={position().x >= 0 && position().x < width() - RULER_BAND}>
						<line
							data-axis="x"
							x1={position().x}
							y1={height() - RULER_BAND}
							x2={position().x}
							y2={height()}
						/>
					</Show>
				</svg>
			)}
		</Show>
	);
}
