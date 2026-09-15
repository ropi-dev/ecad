import { Maximize, Minus, Plus } from "lucide-react";
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
			<button
				type="button"
				className={button}
				disabled={!enabled}
				aria-label="Zoom out"
				onClick={() => zoom(0.8)}
			>
				<Minus size={16} />
			</button>
			<button
				type="button"
				className={button}
				disabled={!enabled}
				aria-label="Zoom in"
				onClick={() => zoom(1.25)}
			>
				<Plus size={16} />
			</button>
			<button
				type="button"
				className={button}
				disabled={!enabled}
				aria-label="Fit model"
				title="Fit model (F6 or double-click the mouse wheel)"
				onClick={fit}
			>
				<Maximize size={16} />
			</button>
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
