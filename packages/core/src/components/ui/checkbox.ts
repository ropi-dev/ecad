export const keepChecked =
	(apply: (checked: boolean) => void) =>
	(event: Event & { currentTarget: HTMLInputElement }) => {
		const next = event.currentTarget.checked;
		event.currentTarget.checked = !next;
		apply(next);
	};
