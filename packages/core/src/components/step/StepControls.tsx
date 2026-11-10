import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";

export function StepControls({
	enabled,
	wireframe,
	onWireframe,
}: {
	enabled: boolean;
	wireframe: boolean;
	onWireframe: () => void;
}) {
	return (
		<TooltipButton
			type="button"
			className={`${viewControlButtonClassName} px-2.5`}
			disabled={!enabled}
			aria-pressed={wireframe}
			tooltip={wireframe ? "Show solid surfaces" : "Show wireframe"}
			onClick={onWireframe}
		>
			Wire
		</TooltipButton>
	);
}
