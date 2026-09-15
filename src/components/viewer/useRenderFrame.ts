import { useCallback, useEffect, useRef } from "react";

/** Coalesces invalidations and cancels pending work before a renderer is disposed. */
export function useRenderFrame() {
	const frame = useRef<number | null>(null);
	const draw = useRef<() => void>(() => {});
	const schedule = useCallback(() => {
		if (frame.current !== null) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = null;
			draw.current();
		});
	}, []);
	const cancel = useCallback(() => {
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
		draw.current = () => {};
	}, []);
	useEffect(() => cancel, [cancel]);
	return { draw, schedule, cancel };
}
