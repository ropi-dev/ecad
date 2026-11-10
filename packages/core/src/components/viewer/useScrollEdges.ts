import { useEffect, useRef } from "react";

/**
 * Marks which sides of a horizontally scrolling row have more content, as
 * `data-fade` ("start", "end", "both" or "") on the row and on its parent.
 * The row fades the clipped side; the parent can show an arrow there.
 * Pass the row element itself, from a state ref, so a row that mounts later
 * is still watched.
 */
export function useScrollEdges(element: HTMLElement | null) {
	const refresh = useRef<() => void>(undefined);
	// Content can widen without resizing the capped row, such as a longer
	// zoom label, so recheck after every render.
	useEffect(() => refresh.current?.());
	useEffect(() => {
		if (!element) return;
		const update = () => {
			const start = element.scrollLeft > 1;
			const end =
				element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
			const fade = start && end ? "both" : start ? "start" : end ? "end" : "";
			if (element.dataset.fade !== fade) {
				element.dataset.fade = fade;
				if (element.parentElement) element.parentElement.dataset.fade = fade;
			}
		};
		update();
		refresh.current = update;
		const observer = new ResizeObserver(update);
		observer.observe(element);
		element.addEventListener("scroll", update, { passive: true });
		return () => {
			refresh.current = undefined;
			observer.disconnect();
			element.removeEventListener("scroll", update);
		};
	}, [element]);
}

/**
 * Fade applied to the clipped side of a row that `useScrollEdges` marks. The
 * last 1rem is fully clear, for the arrow drawn there.
 */
export const scrollFadeClassName =
	"data-[fade=both]:[mask-image:linear-gradient(to_right,transparent_1rem,black_2.5rem,black_calc(100%-2.5rem),transparent_calc(100%-1rem))] data-[fade=end]:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent_calc(100%-1rem))] data-[fade=start]:[mask-image:linear-gradient(to_right,transparent_1rem,black_2.5rem)]";
