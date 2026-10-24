import { useId } from "react";
import {
	type FieldPathByValue,
	type FieldPathValue,
	useFormContext,
	useFormState,
} from "react-hook-form";
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
			<span className="flex items-center gap-2">
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
					className={`rounded border border-[#ffffff20] bg-[#19212e] px-2 py-1 text-[#f0f3f8] focus-visible:outline-2 focus-visible:outline-[#e8b77e] aria-invalid:border-[#ffb4ab] ${numeric ? "w-24 text-right tabular-nums" : "w-32"}`}
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
				{unit && <span className="w-5 text-[#9ba7b8]">{unit}</span>}
			</span>
			{error && (
				<span
					id={errorId}
					role="alert"
					className="max-w-44 text-[12px] text-[#ffb4ab]"
				>
					{error.message}
				</span>
			)}
		</span>
	);
}
