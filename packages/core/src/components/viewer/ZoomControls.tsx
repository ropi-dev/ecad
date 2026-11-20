import type { JSX } from "@solidjs/web";
import { Minus, Plus } from "#/components/ui/icons.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { ZOOM_FACTOR } from "#/engine/navigation.ts";

export function ZoomControls(props: {
	zoom: (factor: number) => void;
	fit: () => void;
	enabled?: boolean;
	canZoomIn?: boolean;
	canZoomOut?: boolean;
	buttonClassName?: string;
	fitClassName?: string;
	fitLabel: string;
	fitTitle: string;
	children: JSX.Element;
	/** Rendered between Fit and Zoom in. */
	extra?: JSX.Element;
}) {
	const enabled = () => props.enabled ?? true;
	return (
		<>
			<TooltipButton
				type="button"
				class={props.buttonClassName}
				disabled={!enabled() || props.canZoomOut === false}
				tooltip="Zoom out"
				shortcut="−"
				aria-label="Zoom out"
				onClick={() => props.zoom(1 / ZOOM_FACTOR)}
			>
				<Minus size={16} />
			</TooltipButton>
			<TooltipButton
				type="button"
				class={props.fitClassName ?? props.buttonClassName}
				disabled={!enabled()}
				tooltip={props.fitTitle}
				shortcut="F6"
				aria-label={props.fitLabel}
				onClick={() => props.fit()}
			>
				{props.children}
			</TooltipButton>
			{props.extra}
			<TooltipButton
				type="button"
				class={props.buttonClassName}
				disabled={!enabled() || props.canZoomIn === false}
				tooltip="Zoom in"
				shortcut="+"
				aria-label="Zoom in"
				onClick={() => props.zoom(ZOOM_FACTOR)}
			>
				<Plus size={16} />
			</TooltipButton>
		</>
	);
}
