import { useLayoutEffect, useRef } from "react";

export function CircuitContextMenu({
	x,
	y,
	actions,
	onClose,
}: {
	x: number;
	y: number;
	actions: { label: string; disabled?: boolean; run(): void }[];
	onClose(): void;
}) {
	const menu = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		menu.current
			?.querySelector<HTMLButtonElement>("button:not(:disabled)")
			?.focus({ preventScroll: true });
	}, []);
	return (
		<div
			ref={menu}
			role="menu"
			aria-label="Graph actions"
			className="circuit-context-menu"
			style={{ left: x, top: y }}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Escape") {
					event.preventDefault();
					onClose();
				}
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					const buttons = Array.from(
						event.currentTarget.querySelectorAll<HTMLButtonElement>(
							"button:not(:disabled)",
						),
					);
					const index = buttons.indexOf(event.target as HTMLButtonElement);
					buttons[
						(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
							buttons.length
					]?.focus();
				}
			}}
		>
			{actions.map((action) => (
				<button
					key={action.label}
					type="button"
					role="menuitem"
					disabled={action.disabled}
					onClick={() => {
						action.run();
						onClose();
					}}
				>
					{action.label}
				</button>
			))}
		</div>
	);
}
