import type { KeyboardEventHandler, ReactNode } from "react";

export function FloatingPanel({
	label,
	position = "top-right",
	as: Element = "aside",
	onKeyDown,
	children,
}: {
	label: string;
	position?: "top-right" | "left-center";
	/** `section` exposes the panel as a region, for tool output such as ERC. */
	as?: "aside" | "section";
	onKeyDown?: KeyboardEventHandler<HTMLElement>;
	children: ReactNode;
}) {
	return (
		<Element
			className={`absolute z-2 flex min-h-0 w-80 flex-col rounded-[10px] border border-[#414955] bg-[#191c22ed] p-[5px] shadow-[0_8px_32px_#0005] backdrop-blur-[12px] ${
				position === "left-center"
					? "top-1/2 left-10 max-h-[calc(100%-176px)] -translate-y-1/2 max-[600px]:left-9 max-[600px]:w-[min(256px,calc(100%-48px))]"
					: "top-10 right-10 max-h-[calc(100%-112px)] max-[600px]:top-22 max-[600px]:right-9 max-[600px]:max-h-[calc(100%-160px)] max-[600px]:w-[min(256px,calc(100%-48px))]"
			}`}
			aria-label={label}
			onKeyDown={onKeyDown}
		>
			{children}
		</Element>
	);
}
