import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
	Show,
} from "solid-js";

type Field = {
	label: string;
	value: string;
	maxLength: number;
	required?: boolean;
};

export function CircuitInlineFields(props: {
	x: number;
	y: number;
	width: number;
	fields: Field[];
	onCommit(values: string[]): boolean;
	onCancel(): void;
	repeatable?: { label: string; action: string; maxLength: number };
}) {
	const [added, setAdded] = createSignal<Field[]>([]);
	const rows = createMemo(() => [...props.fields, ...added()]);
	let form!: HTMLFormElement;
	let finished = false;
	onSettled(() => {
		const input = form.querySelector("input");
		input?.focus({ preventScroll: true });
		input?.select();
	});
	createEffect(
		() => added().length,
		(count) => {
			if (!count) return;
			const inputs = form.querySelectorAll("input");
			inputs[inputs.length - 1]?.focus({ preventScroll: true });
		},
	);
	function commit() {
		if (finished || !form.reportValidity()) return;
		finished = true;
		if (
			!props.onCommit(
				Array.from(form.querySelectorAll("input"), (input) => input.value),
			)
		)
			finished = false;
	}
	return (
		<foreignObject
			x={props.x}
			y={props.y}
			width={props.width}
			height={rows().length * 28 + 8 + (props.repeatable ? 28 : 0)}
		>
			<form
				ref={form}
				class="circuit-inline-fields"
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => event.stopPropagation()}
				onDblClick={(event) => event.stopPropagation()}
				onSubmit={(event) => {
					event.preventDefault();
					commit();
				}}
				onFocusOut={(event) => {
					if (
						!(event.relatedTarget instanceof Node) ||
						!event.currentTarget.contains(event.relatedTarget)
					)
						commit();
				}}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.key === "Escape") {
						event.preventDefault();
						finished = true;
						props.onCancel();
					}
				}}
			>
				<For each={rows()} keyed={(field) => field.label}>
					{(field) => (
						<input
							aria-label={field().label}
							defaultValue={field().value}
							maxlength={field().maxLength}
							required={field().required}
						/>
					)}
				</For>
				<Show when={props.repeatable}>
					{(repeatable) => (
						<button
							type="button"
							class="circuit-add-alias"
							onClick={() =>
								setAdded((current) => [
									...current,
									{
										label: `${repeatable().label} ${props.fields.length + current.length}`,
										value: "",
										maxLength: repeatable().maxLength,
									},
								])
							}
						>
							{repeatable().action}
						</button>
					)}
				</Show>
				<button type="submit" class="sr-only" tabindex={-1}>
					Apply changes
				</button>
			</form>
		</foreignObject>
	);
}
