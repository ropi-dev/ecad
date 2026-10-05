import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { ZOOM_FACTOR } from "#/engine/navigation.ts";

export function ZoomControls({
	zoom,
	fit,
	enabled = true,
	canZoomIn = true,
	canZoomOut = true,
	buttonClassName,
	fitClassName,
	fitLabel,
	fitTitle,
	children,
}: {
	zoom: (factor: number) => void;
	fit: () => void;
	enabled?: boolean;
	canZoomIn?: boolean;
	canZoomOut?: boolean;
	buttonClassName?: string;
	fitClassName?: string;
	fitLabel: string;
	fitTitle: string;
	children: ReactNode;
}) {
	return (
		<>
			<button
				type="button"
				className={buttonClassName}
				disabled={!enabled || !canZoomOut}
				title="Zoom out (-)"
				aria-label="Zoom out"
				onClick={() => zoom(1 / ZOOM_FACTOR)}
			>
				<Minus size={16} />
			</button>
			<button
				type="button"
				className={buttonClassName}
				disabled={!enabled || !canZoomIn}
				title="Zoom in (+)"
				aria-label="Zoom in"
				onClick={() => zoom(ZOOM_FACTOR)}
			>
				<Plus size={16} />
			</button>
			<button
				type="button"
				className={fitClassName ?? buttonClassName}
				disabled={!enabled}
				title={fitTitle}
				aria-label={fitLabel}
				onClick={fit}
			>
				{children}
			</button>
		</>
	);
}
