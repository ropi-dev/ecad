import { type LengthUnit, toMils } from "@ecad/drawing-core/drawing/units.ts";
import {
	type RefObject,
	useLayoutEffect,
	useState,
	useSyncExternalStore,
} from "react";
import type { CanvasView } from "#/components/editor/canvasView.ts";
import { useCursorPoint } from "#/components/editor/useCursorPoint.ts";
import { worldAt } from "#/engine/view-projection.ts";

export function CursorReadout({
	ready,
	cameraView,
	canvasArea,
	unit = "mil",
	height = 0,
	besideAxes = false,
}: {
	unit?: LengthUnit;
	/** Height of the surface the pointer is read on while the view is turned in 3D. */
	height?: number;
	/** Leaves the corner to the axis indicator of a view turned in 3D. */
	besideAxes?: boolean;
	ready: boolean;
	cameraView: CanvasView;
	canvasArea: RefObject<HTMLElement | null>;
}) {
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const view = useSyncExternalStore(
		cameraView.subscribe,
		cameraView.getSnapshot,
		cameraView.getSnapshot,
	);
	const point = useCursorPoint(canvasArea);
	const cursor = point && view ? worldAt(view, point, height) : null;
	const [fits, setFits] = useState(true);
	useLayoutEffect(() => {
		const area = canvasArea.current;
		if (!area || !element) return;
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
		// The flat view and the 3D view each bring their own toolbar.
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
	}, [element, canvasArea]);
	if (!ready) return null;
	return (
		<div
			ref={setElement}
			aria-hidden="true"
			className={`ui-panel pointer-events-none absolute bottom-[calc(var(--chrome-bottom)+env(safe-area-inset-bottom))] z-3 flex h-7 items-center text-xs whitespace-nowrap tabular-nums pointer-coarse:hidden ${besideAxes ? "left-[calc(var(--chrome-gap)+104px)]" : "left-[var(--chrome-gap)]"} ${fits ? "" : "invisible"}`}
		>
			{(["x", "y"] as const).map((axis) => (
				<span
					key={axis}
					className="flex h-full min-w-18 items-center justify-between gap-1.5 border-l border-line-subtle px-2.5 first:border-l-0"
				>
					<span className="text-fg-faint">{axis.toUpperCase()}</span>
					<span className="font-medium">
						{cursor &&
							(unit === "mil"
								? Math.round(toMils(cursor[axis]))
								: cursor[axis].toFixed(2))}
					</span>
				</span>
			))}
		</div>
	);
}
