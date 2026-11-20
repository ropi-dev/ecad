import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";

export function StepControls(props: {
	enabled: boolean;
	wireframe: boolean;
	onWireframe: () => void;
}) {
	return (
		<TooltipButton
			type="button"
			class={`${viewControlButtonClassName} px-2.5`}
			disabled={!props.enabled}
			aria-pressed={props.wireframe ? "true" : "false"}
			tooltip={props.wireframe ? "Show solid surfaces" : "Show wireframe"}
			onClick={() => props.onWireframe()}
		>
			Wire
		</TooltipButton>
	);
}
