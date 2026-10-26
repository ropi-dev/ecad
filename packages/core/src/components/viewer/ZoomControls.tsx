import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
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
			<TooltipButton
				type="button"
				className={buttonClassName}
				disabled={!enabled || !canZoomOut}
				tooltip="Zoom out"
				shortcut="−"
				aria-label="Zoom out"
				onClick={() => zoom(1 / ZOOM_FACTOR)}
			>
				<Minus size={16} />
			</TooltipButton>
			<TooltipButton
				type="button"
				className={buttonClassName}
				disabled={!enabled || !canZoomIn}
				tooltip="Zoom in"
				shortcut="+"
				aria-label="Zoom in"
				onClick={() => zoom(ZOOM_FACTOR)}
			>
				<Plus size={16} />
			</TooltipButton>
			<TooltipButton
				type="button"
				className={fitClassName ?? buttonClassName}
				disabled={!enabled}
				tooltip={fitTitle}
				shortcut="F6"
				aria-label={fitLabel}
				onClick={fit}
			>
				{children}
			</TooltipButton>
		</>
	);
}
