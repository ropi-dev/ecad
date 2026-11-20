import { createMemo, createRenderEffect, createUniqueId, Show } from "solid-js";
import {
	numberInputClassName,
	textInputClassName,
	UnitField,
} from "#/components/editor/SelectionAttributes.tsx";
import {
	type SymbolInstanceAttributeName,
	type SymbolInstanceAttributeValue,
	useSymbolInstanceAttributeForm,
} from "#/components/editor/SymbolInstanceAttributeForm.tsx";

export function SymbolInstanceAttributeInput<
	Name extends SymbolInstanceAttributeName,
>(props: {
	name: Name;
	label: string;
	value: SymbolInstanceAttributeValue<Name> | "";
	unit?: string;
	positive?: boolean;
	step?: string;
	onCommit: (value: SymbolInstanceAttributeValue<Name>) => void;
}) {
	const errorId = createUniqueId();
	const form = useSymbolInstanceAttributeForm();
	const numeric = () => props.unit !== undefined;
	const step = () => props.step ?? "any";
	const error = createMemo(() => form.error(props.name));
	const shown = createMemo<string>((previous) =>
		previous !== undefined && form.editing(props.name)
			? previous
			: form.shown(props.name),
	);
	let input!: HTMLInputElement;
	const view = (
		<span class="flex flex-col items-end gap-1">
			<UnitField unit={props.unit}>
				<input
					ref={input}
					name={props.name}
					type={numeric() ? "number" : "text"}
					aria-label={props.label}
					aria-invalid={error() ? "true" : undefined}
					aria-describedby={error() ? errorId : undefined}
					min={props.positive ? 0 : undefined}
					step={numeric() ? step() : undefined}
					title={step() === "90" ? "Angle in 90° increments" : undefined}
					placeholder={numeric() ? "Mixed" : undefined}
					data-committed-value={props.value}
					class={[
						numeric() ? numberInputClassName : textInputClassName,
						"aria-invalid:border-danger",
					]}
					onInput={(event) =>
						form.input(props.name, {
							text: event.currentTarget.value,
							numeric: numeric(),
						})
					}
					onBlur={(event) => {
						const element = event.currentTarget;
						const committed = form.commit(
							props.name,
							numeric() ? element.valueAsNumber : element.value,
						);
						if (committed)
							props.onCommit(
								committed.value as SymbolInstanceAttributeValue<Name>,
							);
					}}
				/>
			</UnitField>
			<Show when={error()}>
				{(message) => (
					<span
						id={errorId}
						role="alert"
						class="max-w-44 text-right text-xs text-danger"
					>
						{message()}
					</span>
				)}
			</Show>
		</span>
	);
	createRenderEffect(shown, (text) => {
		if (input.value !== text) input.value = text;
	});
	return view;
}
