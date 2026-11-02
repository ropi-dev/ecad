import { circuitGridStep } from "@ecad/drawing-core/circuit/grid.ts";
import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useState,
} from "react";
import { wheelDelta } from "#/engine/navigation.ts";

export type CircuitView = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export function useCircuitNavigation(
	svg: RefObject<SVGSVGElement | null>,
	initialView?: CircuitView,
) {
	const [view, setView] = useState(
		initialView ?? { x: 0, y: 0, width: 1600, height: 760 },
	);
	const [size, setSize] = useState({ width: 0, height: 0 });
	useLayoutEffect(() => {
		const element = svg.current;
		if (!element) return;
		function resize({ width, height }: { width: number; height: number }) {
			setSize((current) =>
				current.width === width && current.height === height
					? current
					: { width, height },
			);
		}
		resize(element.getBoundingClientRect());
		const observer = new ResizeObserver(([entry]) => {
			if (entry) resize(entry.contentRect);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [svg]);
	const scale =
		Math.min(size.width / view.width, size.height / view.height) || 1;
	const gridStep = circuitGridStep(scale);
	const gridSpacing = gridStep * scale;
	const gridStyle = {
		backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
		backgroundPosition: `${(size.width - view.width * scale) / 2 - view.x * scale - gridSpacing / 2}px ${(size.height - view.height * scale) / 2 - view.y * scale - gridSpacing / 2}px`,
	};
	const zoom = useCallback(
		(factor: number, anchor = { x: 0.5, y: 0.5 }) => {
			if (!Number.isFinite(factor) || factor <= 0) return;
			setView((current) => {
				const currentScale =
					Math.min(size.width / current.width, size.height / current.height) ||
					1;
				const targetScale = Math.min(10, Math.max(0.1, currentScale * factor));
				if (Math.abs(targetScale - currentScale) < 1e-9) return current;
				const ratio = targetScale / currentScale;
				const width = current.width / ratio;
				const height = current.height / ratio;
				return {
					x: current.x + (current.width - width) * anchor.x,
					y: current.y + (current.height - height) * anchor.y,
					width,
					height,
				};
			});
		},
		[size.width, size.height],
	);

	useEffect(() => {
		const element = svg.current;
		if (!element) return;
		let safariScale: number | null = null;
		function anchor(event: { clientX: number; clientY: number }) {
			const matrix = element?.getScreenCTM()?.inverse();
			if (!matrix || !element) return undefined;
			const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
				matrix,
			);
			const box = element.viewBox.baseVal;
			return {
				x: (point.x - box.x) / box.width,
				y: (point.y - box.y) / box.height,
			};
		}
		function onWheel(event: WheelEvent) {
			if (!element) return;
			event.preventDefault();
			event.stopPropagation();
			if (safariScale !== null) return;
			const delta = wheelDelta(event, element);
			if (event.ctrlKey || event.metaKey) {
				zoom(0.95 ** (delta.y / 10), anchor(event));
			} else {
				const matrix = element.getScreenCTM();
				if (!matrix) return;
				setView((current) => ({
					...current,
					x: current.x + delta.x / matrix.a,
					y: current.y + delta.y / matrix.d,
				}));
			}
		}
		function onGestureStart(event: Event) {
			event.preventDefault();
			safariScale = 1;
		}
		function onGestureChange(event: Event) {
			event.preventDefault();
			const gesture = event as Event & {
				scale: number;
				clientX: number;
				clientY: number;
			};
			if (
				safariScale === null ||
				!Number.isFinite(gesture.scale) ||
				gesture.scale <= 0
			)
				return;
			zoom(gesture.scale / safariScale, anchor(gesture));
			safariScale = gesture.scale;
		}
		function onGestureEnd() {
			safariScale = null;
		}
		element.addEventListener("wheel", onWheel, { passive: false });
		element.addEventListener("gesturestart", onGestureStart, {
			passive: false,
		});
		element.addEventListener("gesturechange", onGestureChange, {
			passive: false,
		});
		element.addEventListener("gestureend", onGestureEnd);
		window.addEventListener("blur", onGestureEnd);
		return () => {
			element.removeEventListener("wheel", onWheel);
			element.removeEventListener("gesturestart", onGestureStart);
			element.removeEventListener("gesturechange", onGestureChange);
			element.removeEventListener("gestureend", onGestureEnd);
			window.removeEventListener("blur", onGestureEnd);
		};
	}, [svg, zoom]);

	return { view, setView, zoom, gridStyle, gridStep, scale };
}
