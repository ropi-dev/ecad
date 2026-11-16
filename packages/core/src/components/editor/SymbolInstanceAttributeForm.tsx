import {
	type EditorSymbol,
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	extraAttributes,
	SYMBOL_ATTRIBUTE_VALUE_LIMIT,
} from "@ecad/drawing-core/drawing/symbol-attributes.ts";
import { toMils } from "@ecad/drawing-core/drawing/units.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

const number = z.number({ error: "Enter a finite number." });
const schema = z.object({
	attributes: z.object({
		name: z.string(),
		reference: z.string(),
		value: z.string(),
	}),
	extraAttributes: z.array(
		z
			.string()
			.max(
				SYMBOL_ATTRIBUTE_VALUE_LIMIT,
				`Use at most ${SYMBOL_ATTRIBUTE_VALUE_LIMIT} characters.`,
			),
	),
	x: number,
	y: number,
	angle: number.refine((value) => value % 90 === 0, {
		error: "Use an angle in 90° increments.",
	}),
	lineWidth: number
		.positive("Line width must be greater than zero.")
		.nullable(),
});

export type SymbolInstanceAttributeValues = z.infer<typeof schema>;

function displayNumber(value: number) {
	return Number(value.toFixed(4)) || value;
}

export function SymbolInstanceAttributeForm({
	symbol,
	millimetres = false,
	children,
}: {
	symbol: EditorSymbol;
	/** Positions in millimetres, for footprints placed on a board. */
	millimetres?: boolean;
	children: ReactNode;
}) {
	const length = millimetres ? displayNumber : toMils;
	const values = useMemo((): SymbolInstanceAttributeValues => {
		const outlined = symbolShapes(symbol).filter(
			(child) => child.kind !== "text",
		);
		return {
			attributes: {
				name: symbol.attributes.name,
				reference: symbol.attributes.reference,
				value: symbol.attributes.value,
			},
			extraAttributes: extraAttributes(symbol.attributes).map(
				([, value]) => value,
			),
			x: length(symbol.x),
			y: length(symbol.y),
			angle: displayNumber((symbol.rotation * 180) / Math.PI),
			lineWidth:
				outlined.length &&
				outlined.every((child) => child.lineWidth === outlined[0].lineWidth)
					? length(outlined[0].lineWidth)
					: null,
		};
	}, [symbol, length]);
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
