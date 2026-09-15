import type { Viewer3DHandle } from "../viewer/types/Viewer3DHandle";
import { ViewControls3D } from "../viewer/ViewControls3D";

export function StepControls({
	enabled,
	wireframe,
	onWireframe,
	...controls
}: Viewer3DHandle & {
	enabled: boolean;
	wireframe: boolean;
	onWireframe: () => void;
}) {
	return (
		<ViewControls3D {...controls} enabled={enabled}>
			<button
				type="button"
				className="flex h-10 min-w-10 items-center justify-center rounded border border-white/20 px-2 text-xs text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-40"
				disabled={!enabled}
				aria-pressed={wireframe}
				onClick={onWireframe}
			>
				Wire
			</button>
		</ViewControls3D>
	);
}
