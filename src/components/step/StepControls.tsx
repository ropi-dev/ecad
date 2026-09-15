import { Maximize } from "lucide-react";
import { ZoomControls } from "../viewer/ZoomControls";
import type { StepViewerHandle } from "./types/StepViewerHandle";

export function StepControls({
	enabled,
	wireframe,
	onWireframe,
	fit,
	zoom,
	view,
}: StepViewerHandle & {
	enabled: boolean;
	wireframe: boolean;
	onWireframe: () => void;
}) {
	const button =
		"flex h-10 min-w-10 items-center justify-center rounded border border-white/20 px-2 text-xs text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-40";
	return (
		<div
			role="toolbar"
			aria-label="3D view controls"
			className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-0.5 rounded-lg border border-white/20 bg-slate-900/95 p-1 shadow-lg sm:gap-1"
		>
			<ZoomControls
				zoom={zoom}
				fit={fit}
				enabled={enabled}
				buttonClassName={button}
				fitLabel="Fit model"
				fitTitle="Fit model (F6 or double-click the mouse wheel)"
			>
				<Maximize size={16} />
			</ZoomControls>
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
			<button
				type="button"
				className={button}
				disabled={!enabled}
				aria-pressed={wireframe}
				onClick={onWireframe}
			>
				Wire
			</button>
		</div>
	);
}
