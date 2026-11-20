import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { createMemo, Show } from "solid-js";
import { worldToScreen } from "#/engine/camera.ts";
import type { Viewer2DSnapshot } from "#/engine/viewport-types.ts";

const ARM = 2.5;

export function SymbolAnchors(props: {
	view: Viewer2DSnapshot;
	shapes: EditorShape[];
}) {
	const symbols = createMemo(() =>
		props.shapes.filter((shape) => shape.kind === "symbol"),
	);
	const path = createMemo(() => {
		const { width, height } = props.view.viewport;
		let path = "";
		for (const symbol of symbols()) {
			const point = worldToScreen(symbol, props.view.camera, width, height);
			if (
				point.x < -ARM ||
				point.y < -ARM ||
				point.x > width + ARM ||
				point.y > height + ARM
			)
				continue;
			const x = Math.round(point.x) + 0.5;
			const y = Math.round(point.y) + 0.5;
			path += `M${x - ARM} ${y}h${2 * ARM}M${x} ${y - ARM}v${2 * ARM}`;
		}
		return path;
	});
	return (
		<Show when={symbols().length}>
			<svg
				data-testid="symbol-anchors"
				data-count={symbols().length}
				aria-hidden="true"
				class="absolute inset-0 size-full fill-none stroke-accent stroke-1 drop-shadow-[0_0_1px_var(--color-paper)]"
			>
				<path d={path()} />
			</svg>
		</Show>
	);
}
