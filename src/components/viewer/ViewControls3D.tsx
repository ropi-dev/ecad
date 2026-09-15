import { Maximize } from "lucide-react";
import type { ReactNode } from "react";
import type { Viewer3DHandle } from "./types/Viewer3DHandle";
import { ZoomControls } from "./ZoomControls";

export function ViewControls3D({
	enabled,
	children,
	fitLabel = "Fit model",
	fit,
	zoom,
	view,
}: Pick<Viewer3DHandle, "fit" | "zoom"> & {
	view?: Viewer3DHandle["view"];
	enabled: boolean;
	children?: ReactNode;
	fitLabel?: string;
}) {
	const button =
		"flex h-10 min-w-10 items-center justify-center rounded border border-white/20 px-2 text-xs text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-40";
	return (
		<div
			role="toolbar"
			aria-label={view ? "3D view controls" : "View controls"}
			className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-0.5 rounded-lg border border-white/20 bg-slate-900/95 p-1 shadow-lg sm:gap-1"
		>
			<ZoomControls
				zoom={zoom}
				fit={fit}
				enabled={enabled}
				buttonClassName={button}
				fitLabel={fitLabel}
				fitTitle={`${fitLabel} (F6 or double-click the mouse wheel)`}
			>
				<Maximize size={16} />
			</ZoomControls>
			{view && (
				<>
					<button
						type="button"
						className={button}
						disabled={!enabled}
						onClick={() => view("iso")}
					>
						Iso
					</button>
					<button
						type="button"
						className={button}
						disabled={!enabled}
						onClick={() => view("top")}
					>
						Top
					</button>
					<button
						type="button"
						className={button}
						disabled={!enabled}
						onClick={() => view("front")}
					>
						Front
					</button>
				</>
			)}
			{children}
		</div>
	);
}
