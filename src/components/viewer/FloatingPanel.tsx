import type { ReactNode } from "react";

export function FloatingPanel({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<aside className="layer-panel" aria-label={label}>
			{children}
		</aside>
	);
}
