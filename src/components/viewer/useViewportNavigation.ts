import { useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { gestureCamera, panCamera } from "../../engine/navigation";
import type { Camera, Point } from "../../engine/types";

/** Native non-passive listeners prevent page zoom only over the drawing. */
export function useViewportNavigation(
	target: RefObject<HTMLDivElement | null>,
	enabled: boolean,
	baseScale: number,
	setCamera: Dispatch<SetStateAction<Camera>>,
) {
	useEffect(() => {
		const element = target.current;
		if (!element || !enabled) return;
		const pointers = new Map<number, Point>();
		let safariScale: number | null = null;
		const midpoint = (a: Point, b: Point): Point => ({
			x: (a.x + b.x) / 2,
			y: (a.y + b.y) / 2,
		});
		const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
		const local = (event: { clientX: number; clientY: number }): Point => {
			const rect = element.getBoundingClientRect();
			return { x: event.clientX - rect.left, y: event.clientY - rect.top };
		};
		const zoom = (from: Point, to: Point, factor: number) => {
			const { width, height } = element.getBoundingClientRect();
			setCamera((camera) =>
				gestureCamera(camera, from, to, factor, width, height, baseScale),
			);
		};
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			if (safariScale !== null || pointers.size > 1) return;
			const unit =
				event.deltaMode === 1
					? 16
					: event.deltaMode === 2
						? element.clientHeight
						: 1;
			const dy = event.deltaY * unit;
			const point = local(event);
			const sensitivity = event.ctrlKey || event.metaKey ? 0.01 : 0.002;
			zoom(
				point,
				point,
				Math.exp(Math.max(-1, Math.min(1, -dy * sensitivity))),
			);
		};
		const onDown = (event: PointerEvent) => {
			if (
				event.target instanceof Element &&
				event.target.closest("[data-view-controls]")
			)
				return;
			if (
				event.pointerType === "mouse" &&
				event.button !== 0 &&
				event.button !== 1
			)
				return;
			event.preventDefault();
			element.focus({ preventScroll: true });
			element.setPointerCapture(event.pointerId);
			pointers.set(event.pointerId, local(event));
		};
		const onMove = (event: PointerEvent) => {
			const previous = pointers.get(event.pointerId);
			if (!previous) return;
			const before = [...pointers.values()];
			const next = local(event);
			pointers.set(event.pointerId, next);
			if (safariScale !== null) return;
			if (pointers.size === 1) {
				setCamera((camera) =>
					panCamera(camera, { x: next.x - previous.x, y: next.y - previous.y }),
				);
			} else {
				const after = [...pointers.values()];
				const oldDistance = distance(before[0], before[1]);
				zoom(
					midpoint(before[0], before[1]),
					midpoint(after[0], after[1]),
					oldDistance > 0 ? distance(after[0], after[1]) / oldDistance : 1,
				);
			}
		};
		const onUp = (event: PointerEvent) => {
			pointers.delete(event.pointerId);
			if (element.hasPointerCapture(event.pointerId))
				element.releasePointerCapture(event.pointerId);
		};
		// Safari trackpad gestures use cumulative scale instead of Ctrl+wheel.
		const onGestureStart = (event: Event) => {
			event.preventDefault();
			if (pointers.size < 2) safariScale = 1;
		};
		const onGestureChange = (event: Event) => {
			event.preventDefault();
			if (safariScale === null) return;
			const gesture = event as Event & {
				scale: number;
				clientX: number;
				clientY: number;
			};
			if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
			const point = local(gesture);
			zoom(point, point, gesture.scale / safariScale);
			safariScale = gesture.scale;
		};
		const onGestureEnd = (event: Event) => {
			event.preventDefault();
			safariScale = null;
		};
		const clear = () => {
			for (const id of pointers.keys())
				if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
			pointers.clear();
			safariScale = null;
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		element.addEventListener("pointerdown", onDown);
		element.addEventListener("pointermove", onMove);
		element.addEventListener("pointerup", onUp);
		element.addEventListener("pointercancel", onUp);
		element.addEventListener("lostpointercapture", onUp);
		element.addEventListener("gesturestart", onGestureStart, {
			passive: false,
		});
		element.addEventListener("gesturechange", onGestureChange, {
			passive: false,
		});
		element.addEventListener("gestureend", onGestureEnd, { passive: false });
		window.addEventListener("blur", clear);
		return () => {
			element.removeEventListener("wheel", onWheel);
			element.removeEventListener("pointerdown", onDown);
			element.removeEventListener("pointermove", onMove);
			element.removeEventListener("pointerup", onUp);
			element.removeEventListener("pointercancel", onUp);
			element.removeEventListener("lostpointercapture", onUp);
			element.removeEventListener("gesturestart", onGestureStart);
			element.removeEventListener("gesturechange", onGestureChange);
			element.removeEventListener("gestureend", onGestureEnd);
			window.removeEventListener("blur", clear);
			clear();
		};
	}, [target, enabled, baseScale, setCamera]);
}
