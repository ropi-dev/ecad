import { For, onSettled } from "solid-js";

export function CircuitContextMenu(props: {
	x: number;
	y: number;
	actions: { label: string; disabled?: boolean; run(): void }[];
	onClose(): void;
}) {
	let menu!: HTMLDivElement;
	onSettled(() => {
		menu
			.querySelector<HTMLButtonElement>("button:not(:disabled)")
			?.focus({ preventScroll: true });
	});
	return (
		<div
			ref={menu}
			role="menu"
			aria-label="Graph actions"
			class="circuit-context-menu"
			style={{ left: `${props.x}px`, top: `${props.y}px` }}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Escape") {
					event.preventDefault();
					props.onClose();
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
			<For each={props.actions} keyed={(action) => action.label}>
				{(action) => (
					<button
						type="button"
						role="menuitem"
						disabled={action().disabled}
						onClick={() => {
							action().run();
							props.onClose();
						}}
					>
						{action().label}
					</button>
				)}
			</For>
		</div>
	);
}
