import { toMils } from "@ecad/drawing-core/drawing/units.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { CanvasView } from "#/components/editor/canvasView.ts";
import { useCanvasProjection } from "#/components/editor/useCanvasProjection.ts";
import { useCursorPoint } from "#/components/editor/useCursorPoint.ts";
import type { GridUnit } from "#/engine/ruler.ts";

const AXES = ["x", "y"] as const;

function ReadoutPanel(props: {
	canvasArea: HTMLElement | null | undefined;
	besideAxes: boolean;
	children: JSX.Element;
}) {
	let element!: HTMLDivElement;
	const [fits, setFits] = createSignal(true);
	createEffect(
		() => props.canvasArea,
		(area) => {
			if (!area) return;
			let dock: Element | null = null;
			const measure = () =>
				setFits(
					!dock ||
						element.getBoundingClientRect().right + 8 <=
							dock.getBoundingClientRect().left,
				);
			const sizes = new ResizeObserver(measure);
			sizes.observe(area);
			sizes.observe(element);
			const follow = () => {
				const next = area.querySelector('[role="toolbar"]');
				if (next === dock) return;
				if (dock) sizes.unobserve(dock);
				dock = next;
				if (dock) sizes.observe(dock);
				else measure();
			};
			follow();
			const nodes = new MutationObserver(follow);
			nodes.observe(area, { childList: true, subtree: true });
			return () => {
				sizes.disconnect();
				nodes.disconnect();
			};
		},
	);
	return (
		<div
			ref={element}
			aria-hidden="true"
			data-testid="cursor-readout"
			class={[
				"ui-panel pointer-events-none absolute bottom-[calc(var(--chrome-bottom)+env(safe-area-inset-bottom))] z-3 flex h-7 items-center text-xs whitespace-nowrap tabular-nums pointer-coarse:hidden",
				props.besideAxes
					? "left-[calc(var(--chrome-gap)+6.5rem)]"
					: "left-[var(--chrome-gap)]",
				{ invisible: !fits() },
			]}
		>
			{props.children}
		</div>
	);
}

export function CursorReadout(props: {
	unit?: GridUnit;
	layer?: FootprintLayer;
	besideAxes?: boolean;
	ready: boolean;
	cameraView: CanvasView;
	canvasArea: HTMLElement | null | undefined;
}) {
	const projection = useCanvasProjection(() => props.cameraView);
	const point = useCursorPoint(() => props.canvasArea);
	const cursor = createMemo(() => {
		const at = point();
		const view = projection();
		return at && view
			? view.toWorld(at, view.layerHeight(props.layer ? [props.layer] : []))
			: null;
	});
	const coordinate = (axis: (typeof AXES)[number]) => {
		const at = cursor();
		if (!at) return undefined;
		const unit = props.unit ?? "schematic";
		return unit === "schematic"
			? Math.round(toMils(at[axis]))
			: unit === "mil"
				? toMils(at[axis]).toFixed(1)
				: at[axis].toFixed(2);
	};
	return (
		<Show when={props.ready}>
			<ReadoutPanel
				canvasArea={props.canvasArea}
				besideAxes={props.besideAxes ?? false}
			>
				<For each={AXES}>
					{(axis) => (
						<span class="flex h-full min-w-18 items-center justify-between gap-1.5 border-l border-line-subtle px-2.5 first:border-l-0">
							<span class="text-fg-faint">{axis.toUpperCase()}</span>
							<span class="font-medium">{coordinate(axis)}</span>
						</span>
					)}
				</For>
			</ReadoutPanel>
		</Show>
	);
}
