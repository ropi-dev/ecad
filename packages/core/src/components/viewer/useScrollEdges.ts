import { type Accessor, createEffect } from "solid-js";

/**
 * Marks which sides of a horizontally scrolling row have more content, as
 * `data-fade` ("start", "end", "both" or "") on the row and on its parent.
 * The row fades the clipped side; the parent can show an arrow there.
 */
export function useScrollEdges(
	element: Accessor<HTMLElement | null | undefined>,
) {
	createEffect(element, (row) => {
		if (!row) return;
		const update = () => {
			const start = row.scrollLeft > 1;
			const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
			const fade = start && end ? "both" : start ? "start" : end ? "end" : "";
			if (row.dataset.fade !== fade) {
				row.dataset.fade = fade;
				if (row.parentElement) row.parentElement.dataset.fade = fade;
			}
		};
		update();
		const resized = new ResizeObserver(update);
		resized.observe(row);
		// Content can widen without resizing the capped row, such as a longer
		// zoom label.
		const changed = new MutationObserver(update);
		changed.observe(row, {
			childList: true,
			subtree: true,
			characterData: true,
		});
		row.addEventListener("scroll", update, { passive: true });
		return () => {
			resized.disconnect();
			changed.disconnect();
			row.removeEventListener("scroll", update);
		};
	});
}

/**
 * Fade applied to the clipped side of a row that `useScrollEdges` marks. The
 * last 1rem is fully clear, for the arrow drawn there.
 */
export const scrollFadeClassName =
	"data-[fade=both]:[mask-image:linear-gradient(to_right,transparent_1rem,black_2.5rem,black_calc(100%-2.5rem),transparent_calc(100%-1rem))] data-[fade=end]:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent_calc(100%-1rem))] data-[fade=start]:[mask-image:linear-gradient(to_right,transparent_1rem,black_2.5rem)]";
