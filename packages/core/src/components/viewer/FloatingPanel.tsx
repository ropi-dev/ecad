import { Dynamic, type JSX } from "@solidjs/web";

export type FloatingPanelPosition = "top-right" | "top-left" | "left-center";

// Panels keep clear of the rulers, the document bar and the dock. In a narrow
// pane they become a sheet above the dock instead, unless `sheet` is false.
const sheetClassName =
	"@max-[540px]:inset-x-[var(--chrome-gap)] @max-[540px]:top-auto @max-[540px]:bottom-[calc(var(--chrome-dock)+env(safe-area-inset-bottom))] @max-[540px]:max-h-[45%] @max-[540px]:w-auto @max-[540px]:translate-y-0";
const anchoredClassName = "max-w-[calc(100%-2*var(--chrome-gap))]";
const positionClassName: Record<FloatingPanelPosition, string> = {
	"top-right":
		"top-[var(--chrome-top)] right-[var(--chrome-right)] max-h-[calc(100%-var(--chrome-top)-var(--chrome-dock))]",
	"top-left":
		"top-[calc(var(--chrome-top)+var(--chrome-bar))] left-[var(--chrome-gap)] max-h-[calc(100%-var(--chrome-top)-var(--chrome-bar)-var(--chrome-dock))]",
	"left-center":
		"top-1/2 left-[var(--chrome-gap)] max-h-[calc(100%-2*var(--chrome-dock))] -translate-y-1/2",
};
const mediumPositionClassName: Partial<Record<FloatingPanelPosition, string>> =
	{
		"top-right":
			"@max-[680px]:top-[calc(var(--chrome-top)+var(--chrome-bar))] @max-[680px]:max-h-[calc(100%-var(--chrome-top)-var(--chrome-bar)-var(--chrome-dock))]",
	};

export function FloatingPanel(props: {
	label: string;
	position?: FloatingPanelPosition;
	/** `section` exposes the panel as a region, for tool output such as ERC. */
	as?: "aside" | "section";
	/** Floats above the editor header and messages, for panels the user opens. */
	raised?: boolean;
	narrow?: boolean;
	sheet?: boolean;
	onKeyDown?: JSX.EventHandler<HTMLElement, KeyboardEvent>;
	children: JSX.Element;
}) {
	return (
		<Dynamic
			component={props.as ?? "aside"}
			class={[
				"ui-panel absolute flex min-h-0 flex-col overflow-hidden bg-raised",
				props.raised ? "z-5" : "z-3",
				props.narrow ? "w-56" : "w-72",
				positionClassName[props.position ?? "top-right"],
				props.sheet === false
					? anchoredClassName
					: [
							mediumPositionClassName[props.position ?? "top-right"],
							sheetClassName,
						],
			]}
			aria-label={props.label}
			onKeyDown={(
				event: KeyboardEvent & { currentTarget: HTMLElement; target: Element },
			) => props.onKeyDown?.(event)}
		>
			{props.children}
		</Dynamic>
	);
}
