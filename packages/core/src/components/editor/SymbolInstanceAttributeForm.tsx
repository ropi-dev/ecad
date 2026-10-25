import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";
import { type EditorSymbol, symbolTextPosition } from "#/drawing/shapes.ts";

const number = z.number({ error: "Enter a finite number." });
const position = z.object({ x: number, y: number });
const schema = z.object({
	attributes: z.object({
		name: z.string(),
		reference: z.string(),
		value: z.string(),
	}),
	x: number,
	y: number,
	angle: number.refine((value) => value % 90 === 0, {
		error: "Use an angle in 90° increments.",
	}),
	lineWidth: number
		.positive("Line width must be greater than zero.")
		.nullable(),
	textPositions: z.object({
		name: position,
		reference: position,
		value: position,
	}),
});

export type SymbolInstanceAttributeValues = z.infer<typeof schema>;

function displayNumber(value: number) {
	return Number(value.toFixed(4)) || value;
}

export function SymbolInstanceAttributeForm({
	symbol,
	children,
}: {
	symbol: EditorSymbol;
	children: ReactNode;
}) {
	const values = useMemo((): SymbolInstanceAttributeValues => {
		const outlined = symbol.children.filter((child) => child.kind !== "text");
		const textPositions = {
			name: { x: 0, y: 0 },
			reference: { x: 0, y: 0 },
			value: { x: 0, y: 0 },
		};
		for (const text of symbol.texts) {
			const position = symbolTextPosition(symbol, text);
			textPositions[text.attribute] = {
				x: displayNumber(position.x),
				y: displayNumber(position.y),
			};
		}
		return {
			attributes: { ...symbol.attributes },
			x: displayNumber(symbol.x),
			y: displayNumber(symbol.y),
			angle: displayNumber((symbol.rotation * 180) / Math.PI),
			lineWidth:
				outlined.length &&
				outlined.every((child) => child.lineWidth === outlined[0].lineWidth)
					? displayNumber(outlined[0].lineWidth)
					: null,
			textPositions,
		};
	}, [symbol]);
	const form = useForm({
		values,
		resolver: zodResolver(schema, undefined, { mode: "sync" }),
		resetOptions: { keepDirtyValues: true, keepErrors: true },
	});
	return (
		<FormProvider {...form}>
			<form
				aria-label="Symbol instance attributes"
				className="contents"
				noValidate
				onSubmit={(event) => event.preventDefault()}
			>
				{children}
			</form>
		</FormProvider>
	);
}
