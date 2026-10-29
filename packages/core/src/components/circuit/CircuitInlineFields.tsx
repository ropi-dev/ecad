import { useLayoutEffect, useRef, useState } from "react";

export function CircuitInlineFields({
	x,
	y,
	width,
	fields,
	onCommit,
	onCancel,
	repeatable,
}: {
	x: number;
	y: number;
	width: number;
	fields: {
		label: string;
		value: string;
		maxLength: number;
		required?: boolean;
	}[];
	onCommit(values: string[]): boolean;
	onCancel(): void;
	repeatable?: { label: string; action: string; maxLength: number };
}) {
	const [rows, setRows] = useState(fields);
	const form = useRef<HTMLFormElement>(null);
	const finished = useRef(false);
	useLayoutEffect(() => {
		const input = form.current?.querySelector("input");
		input?.focus({ preventScroll: true });
		input?.select();
	}, []);
	useLayoutEffect(() => {
		if (rows.length > fields.length) {
			const inputs = form.current?.querySelectorAll("input");
			inputs?.[inputs.length - 1]?.focus({ preventScroll: true });
		}
	}, [rows.length, fields.length]);
	function commit() {
		if (finished.current || !form.current?.reportValidity()) return;
		finished.current = true;
		if (
			!onCommit(
				Array.from(
					form.current.querySelectorAll("input"),
					(input) => input.value,
				),
			)
		)
			finished.current = false;
	}
	return (
		<foreignObject
			x={x}
			y={y}
			width={width}
			height={rows.length * 28 + 8 + (repeatable ? 28 : 0)}
		>
			<form
				ref={form}
				className="circuit-inline-fields"
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => event.stopPropagation()}
				onDoubleClick={(event) => event.stopPropagation()}
				onSubmit={(event) => {
					event.preventDefault();
					commit();
				}}
				onBlur={(event) => {
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
						finished.current = true;
						onCancel();
					}
				}}
			>
				{rows.map((field) => (
					<input
						key={field.label}
						aria-label={field.label}
						defaultValue={field.value}
						maxLength={field.maxLength}
						required={field.required}
					/>
				))}
				{repeatable && (
					<button
						type="button"
						className="circuit-add-alias"
						onClick={() =>
							setRows((current) => [
								...current,
								{
									label: `${repeatable.label} ${current.length}`,
									value: "",
									maxLength: repeatable.maxLength,
								},
							])
						}
					>
						{repeatable.action}
					</button>
				)}
				<button type="submit" className="sr-only" tabIndex={-1}>
					Apply changes
				</button>
			</form>
		</foreignObject>
	);
}
