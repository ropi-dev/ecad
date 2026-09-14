import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { indexGerberNets } from "../../formats/gerber/nets";
import { screenToWorld } from "../../engine/camera";
import type { Camera, GraphicsRenderer, SceneLayer } from "../../engine/types";

/** Coalesce pointer movement, and redraw only when the hovered net changes. */
export function useNetHover(
	target: RefObject<HTMLDivElement | null>,
	renderer: RefObject<GraphicsRenderer | null>,
	layer: SceneLayer | null,
	camera: Camera,
	size: { width: number; height: number },
) {
	const [hoveredIds, setHoveredIds] = useState<ReadonlySet<string>>();
	const nets = useMemo(
		() =>
			layer ? indexGerberNets(layer) : new Map<string, ReadonlySet<string>>(),
		[layer],
	);
	const pointer = useRef<{ x: number; y: number } | null>(null);
	const pick = useRef<() => void>(() => {});
	const schedule = useRef<() => void>(() => {});

	useEffect(() => {
		const element = target.current;
		if (!element) return;
		let frame: number | null = null;
		schedule.current = () => {
			if (frame !== null) return;
			frame = requestAnimationFrame(() => {
				frame = null;
				pick.current();
			});
		};
		const clear = () => {
			pointer.current = null;
			setHoveredIds(undefined);
		};
		const move = (event: PointerEvent) => {
			if (
				event.pointerType === "touch" ||
				event.buttons ||
				!(event.target instanceof HTMLCanvasElement)
			) {
				clear();
				return;
			}
			pointer.current = { x: event.clientX, y: event.clientY };
			schedule.current();
		};
		element.addEventListener("pointermove", move);
		element.addEventListener("pointerup", move);
		element.addEventListener("pointerdown", clear);
		element.addEventListener("pointerleave", clear);
		element.addEventListener("pointercancel", clear);
		window.addEventListener("blur", clear);
		return () => {
			if (frame !== null) cancelAnimationFrame(frame);
			schedule.current = () => {};
			element.removeEventListener("pointermove", move);
			element.removeEventListener("pointerup", move);
			element.removeEventListener("pointerdown", clear);
			element.removeEventListener("pointerleave", clear);
			element.removeEventListener("pointercancel", clear);
			window.removeEventListener("blur", clear);
		};
	}, [target]);

	useEffect(() => {
		pick.current = () => {
			if (!pointer.current || !layer || !renderer.current || !target.current) {
				setHoveredIds(undefined);
				return;
			}
			const rect = target.current.getBoundingClientRect();
			const point = screenToWorld(
				{ x: pointer.current.x - rect.left, y: pointer.current.y - rect.top },
				camera,
				size.width,
				size.height,
			);
			// A small screen-space margin makes thin traces practical to target.
			const hit = renderer.current.hitTest([layer], point, 2 / camera.scale);
			setHoveredIds(hit ? nets.get(hit.object.id) : undefined);
		};
		schedule.current();
	}, [target, renderer, layer, camera, size, nets]);

	return hoveredIds;
}
