import { ShieldCheck } from "lucide-react";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";

/** Toolbar toggle for the electrical rules check panel. */
export function ErcButton({
	open,
	disabled = false,
	onClick,
}: {
	open: boolean;
	disabled?: boolean;
	onClick(): void;
}) {
	return (
		<TooltipButton
			type="button"
			className={viewControlButtonClassName}
			tooltip="Electrical rules check"
			aria-label="Electrical rules check"
			aria-pressed={open}
			disabled={disabled}
			onClick={onClick}
		>
			<ShieldCheck size={18} aria-hidden="true" />
		</TooltipButton>
	);
}
