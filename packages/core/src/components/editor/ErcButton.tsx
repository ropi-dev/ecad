import { ShieldCheck } from "#/components/ui/icons.tsx";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";

/** Toolbar toggle for the electrical rules check panel. */
export function ErcButton(props: {
	open: boolean;
	disabled?: boolean;
	onClick(): void;
}) {
	return (
		<TooltipButton
			type="button"
			class={viewControlButtonClassName}
			tooltip="Electrical rules check"
			aria-label="Electrical rules check"
			aria-pressed={props.open ? "true" : "false"}
			disabled={props.disabled ?? false}
			onClick={() => props.onClick()}
		>
			<ShieldCheck size={18} aria-hidden="true" />
		</TooltipButton>
	);
}
