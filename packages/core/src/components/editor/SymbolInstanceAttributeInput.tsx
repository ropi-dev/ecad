import { useId } from "react";
import {
	type FieldPathByValue,
	type FieldPathValue,
	useFormContext,
	useFormState,
} from "react-hook-form";
import {
	numberInputClassName,
	textInputClassName,
	UnitField,
} from "#/components/editor/SelectionAttributes.tsx";
import type { SymbolInstanceAttributeValues } from "#/components/editor/SymbolInstanceAttributeForm.tsx";

export function SymbolInstanceAttributeInput<
	Name extends FieldPathByValue<
		SymbolInstanceAttributeValues,
		string | number | null
	>,
>({
	name,
	label,
	value,
	unit,
	positive = false,
	step = "any",
	onCommit,
}: {
	name: Name;
	label: string;
	value: FieldPathValue<SymbolInstanceAttributeValues, Name> | "";
	unit?: string;
	positive?: boolean;
	step?: string;
	onCommit: (
		value: FieldPathValue<SymbolInstanceAttributeValues, Name>,
	) => void;
}) {
	const errorId = useId();
	const { register, control, trigger, getValues, getFieldState, resetField } =
		useFormContext<SymbolInstanceAttributeValues>();
	const formState = useFormState({ control, name, exact: true });
	const { error } = getFieldState(name, formState);
	const numeric = unit !== undefined;
	const field = register(name, { valueAsNumber: numeric });
	return (
		<span className="flex flex-col items-end gap-1">
			<UnitField unit={unit}>
				<input
					{...field}
					type={numeric ? "number" : "text"}
					aria-label={label}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? errorId : undefined}
					min={positive ? 0 : undefined}
					step={numeric ? step : undefined}
					title={step === "90" ? "Angle in 90° increments" : undefined}
					placeholder={numeric ? "Mixed" : undefined}
					data-committed-value={value}
					className={`${numeric ? numberInputClassName : textInputClassName} aria-invalid:border-danger`}
					onBlur={async (event) => {
						await field.onBlur(event);
						const state = getFieldState(name);
						if (!state.isDirty && !state.error) return;
						if (!(await trigger(name)) || !getFieldState(name).isDirty) return;
						const next = getValues(name);
						resetField(name, { defaultValue: next });
						onCommit(next);
					}}
				/>
			</UnitField>
			{error && (
				<span
					id={errorId}
					role="alert"
					className="max-w-44 text-right text-xs text-danger"
				>
					{error.message}
				</span>
			)}
		</span>
	);
}
