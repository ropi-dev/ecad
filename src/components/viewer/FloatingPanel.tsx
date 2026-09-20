import type { ReactNode } from "react";

export function FloatingPanel({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<aside
			className="absolute top-10 right-4 z-2 flex max-h-[calc(100%-112px)] min-h-0 w-80 flex-col rounded-[10px] border border-[#414955] bg-[#191c22ed] p-[5px] shadow-[0_8px_32px_#0005] backdrop-blur-[12px] max-[600px]:top-22 max-[600px]:right-3 max-[600px]:max-h-[calc(100%-160px)] max-[600px]:w-[min(256px,calc(100%-24px))]"
			aria-label={label}
		>
			{children}
		</aside>
	);
}
