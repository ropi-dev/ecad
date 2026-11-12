import { type RefObject, useEffect, useState } from "react";

export function useViewportSize(container: RefObject<HTMLElement | null>) {
	const [size, setSize] = useState<{ width: number; height: number } | null>(
		null,
	);
	useEffect(() => {
		const element = container.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			if (!(width > 0 && height > 0)) return;
			setSize((previous) =>
				previous?.width === width && previous.height === height
					? previous
					: { width, height },
			);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [container]);
	return size;
}
