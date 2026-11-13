import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import { type RefObject, useEffect, useState } from "react";

export function useCursorPoint(area: RefObject<HTMLElement | null>) {
	const [point, setPoint] = useState<Point | null>(null);
	useEffect(() => {
		const element = area.current;
		if (!element) return;
		let frame = 0;
		let last: PointerEvent | null = null;
		const report = () => {
			frame = 0;
			if (!last) return;
			const rect = element.getBoundingClientRect();
			setPoint({ x: last.clientX - rect.left, y: last.clientY - rect.top });
		};
		const move = (event: PointerEvent) => {
			last = event;
			if (!frame) frame = requestAnimationFrame(report);
		};
		const leave = () => {
			cancelAnimationFrame(frame);
			frame = 0;
			setPoint(null);
		};
		element.addEventListener("pointermove", move);
		element.addEventListener("pointerleave", leave);
		return () => {
			cancelAnimationFrame(frame);
			element.removeEventListener("pointermove", move);
			element.removeEventListener("pointerleave", leave);
		};
	}, [area]);
	return point;
}
