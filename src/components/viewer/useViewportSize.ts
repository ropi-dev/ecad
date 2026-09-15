import { type RefObject, useEffect, useState } from "react";

export function useViewportSize(container: RefObject<HTMLElement | null>) {
	const [size, setSize] = useState({ width: 1, height: 1 });
	useEffect(() => {
		const element = container.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			const width = Math.max(entry.contentRect.width, 1);
			const height = Math.max(entry.contentRect.height, 1);
			setSize((previous) =>
				previous.width === width && previous.height === height
					? previous
					: { width, height },
			);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [container]);
	return size;
}
