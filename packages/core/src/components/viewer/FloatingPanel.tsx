import { Dynamic, type JSX } from "@solidjs/web";

export type FloatingPanelPosition = "top-right" | "top-left" | "left-center";

// Panels keep clear of the rulers, the document bar and the dock. On a phone
// they become a sheet above the dock instead.
const sheet =
	"max-[760px]:inset-x-[var(--chrome-gap)] max-[760px]:top-auto max-[760px]:bottom-[calc(var(--chrome-dock)+env(safe-area-inset-bottom))] max-[760px]:max-h-[45%] max-[760px]:w-auto max-[760px]:translate-y-0";
const positionClassName: Record<FloatingPanelPosition, string> = {
	"top-right": `top-[calc(var(--chrome-top)+var(--chrome-top-right,0px))] right-[var(--chrome-right)] max-h-[calc(100%-var(--chrome-top)-var(--chrome-top-right,0px)-var(--chrome-dock))] ${sheet}`,
	"top-left": `top-[calc(var(--chrome-top)+var(--chrome-bar))] left-[var(--chrome-gap)] max-h-[calc(100%-var(--chrome-top)-var(--chrome-bar)-var(--chrome-dock))] ${sheet}`,
	"left-center": `top-1/2 left-[var(--chrome-gap)] max-h-[calc(100%-2*var(--chrome-dock))] -translate-y-1/2 ${sheet}`,
};

export function FloatingPanel(props: {
	label: string;
	position?: FloatingPanelPosition;
	/** `section` exposes the panel as a region, for tool output such as ERC. */
	as?: "aside" | "section";
	/** Floats above the editor header and messages, for panels the user opens. */
	raised?: boolean;
	narrow?: boolean;
	onKeyDown?: JSX.EventHandler<HTMLElement, KeyboardEvent>;
	children: JSX.Element;
}) {
	return (
		<Dynamic
			component={props.as ?? "aside"}
			class={[
				"ui-panel absolute flex min-h-0 flex-col overflow-hidden bg-raised",
				props.raised ? "z-5" : "z-2",
				props.narrow ? "w-56" : "w-72",
				props.position === "top-right" || !props.position
					? "max-w-[calc(100%-var(--chrome-gap)-var(--chrome-right))]"
					: "max-w-[calc(100%-2*var(--chrome-gap))]",
				positionClassName[props.position ?? "top-right"],
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
