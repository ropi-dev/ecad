import { type LengthUnit, toMils } from "@ecad/drawing-core/drawing/units.ts";
import {
	type RefObject,
	useLayoutEffect,
	useState,
	useSyncExternalStore,
} from "react";
import type { CanvasView } from "#/components/editor/canvasView.ts";
import { useCursorPoint } from "#/components/editor/useCursorPoint.ts";

export function CursorReadout({
	ready,
	cameraView,
	canvasArea,
	unit = "mil",
}: {
	unit?: LengthUnit;
	ready: boolean;
	cameraView: CanvasView;
	canvasArea: RefObject<HTMLElement | null>;
}) {
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const projection = useSyncExternalStore(
		cameraView.subscribe,
		cameraView.getProjection,
		cameraView.getProjection,
	);
	const point = useCursorPoint(canvasArea);
	const cursor = point && projection ? projection.toWorld(point) : null;
	const [fits, setFits] = useState(true);
	useLayoutEffect(() => {
		const area = canvasArea.current;
		const dock = area?.querySelector('[role="toolbar"]');
		if (!area || !element || !dock) return;
		const observer = new ResizeObserver(() =>
			setFits(
				element.getBoundingClientRect().right + 8 <=
					dock.getBoundingClientRect().left,
			),
		);
		for (const target of [area, element, dock]) observer.observe(target);
		return () => observer.disconnect();
	}, [element, canvasArea]);
	if (!ready) return null;
	return (
		<div
			ref={setElement}
			aria-hidden="true"
			className={`ui-panel pointer-events-none absolute bottom-[calc(var(--chrome-bottom)+env(safe-area-inset-bottom))] left-[var(--chrome-gap)] z-3 flex h-7 items-center text-xs whitespace-nowrap tabular-nums pointer-coarse:hidden ${fits ? "" : "invisible"}`}
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
