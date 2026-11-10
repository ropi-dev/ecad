import type { KeyboardEventHandler, ReactNode } from "react";

export type FloatingPanelPosition = "top-right" | "top-left" | "left-center";

// Panels keep clear of the rulers, the document bar and the dock. On a phone
// they become a sheet above the dock instead.
const sheet =
	"max-[760px]:inset-x-[var(--chrome-gap)] max-[760px]:top-auto max-[760px]:bottom-[calc(var(--chrome-dock)+env(safe-area-inset-bottom))] max-[760px]:max-h-[45%] max-[760px]:w-auto max-[760px]:translate-y-0";
const positionClassName: Record<FloatingPanelPosition, string> = {
	"top-right": `top-[var(--chrome-top)] right-[var(--chrome-right)] max-h-[calc(100%-var(--chrome-top)-var(--chrome-dock))] ${sheet}`,
	"top-left": `top-[calc(var(--chrome-top)+var(--chrome-bar))] left-[var(--chrome-gap)] max-h-[calc(100%-var(--chrome-top)-var(--chrome-bar)-var(--chrome-dock))] ${sheet}`,
	"left-center": `top-1/2 left-[var(--chrome-gap)] max-h-[calc(100%-2*var(--chrome-dock))] -translate-y-1/2 ${sheet}`,
};

export function FloatingPanel({
	label,
	position = "top-right",
	as: Element = "aside",
	raised = false,
	onKeyDown,
	children,
}: {
	label: string;
	position?: FloatingPanelPosition;
	/** `section` exposes the panel as a region, for tool output such as ERC. */
	as?: "aside" | "section";
	/** Floats above the editor header and messages, for panels the user opens. */
	raised?: boolean;
	onKeyDown?: KeyboardEventHandler<HTMLElement>;
	children: ReactNode;
}) {
	return (
		<Element
			className={`ui-panel absolute bg-raised ${raised ? "z-5" : "z-2"} flex min-h-0 w-72 flex-col overflow-hidden ${positionClassName[position]}`}
			aria-label={label}
			onKeyDown={onKeyDown}
		>
			{children}
		</Element>
	);
}
