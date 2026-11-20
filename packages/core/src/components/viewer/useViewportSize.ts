import { type Accessor, createEffect, createSignal } from "solid-js";

type Size = { width: number; height: number };

export function useViewportSize(
	container: Accessor<HTMLElement | null | undefined>,
): Accessor<Size | null> {
	const [size, setSize] = createSignal<Size | null>(null, {
		equals: (previous, next) =>
			previous?.width === next?.width && previous?.height === next?.height,
	});
	createEffect(container, (element) => {
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			if (width > 0 && height > 0) setSize({ width, height });
		});
		observer.observe(element);
		return () => observer.disconnect();
	});
	return size;
}
