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
		<button
			type="button"
			className={viewControlButtonClassName}
			disabled={!enabled}
			aria-pressed={wireframe}
			onClick={onWireframe}
		>
			Wire
		</button>
	);
}
