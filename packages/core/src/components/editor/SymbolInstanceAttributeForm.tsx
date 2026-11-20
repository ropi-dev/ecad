import {
	type EditorSymbol,
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	extraAttributes,
	SYMBOL_ATTRIBUTE_VALUE_LIMIT,
} from "@ecad/drawing-core/drawing/symbol-attributes.ts";
import { toMils } from "@ecad/drawing-core/drawing/units.ts";
import type { JSX } from "@solidjs/web";
import {
	createContext,
	createEffect,
	createMemo,
	createStore,
	useContext,
} from "solid-js";
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

type NumberField = "x" | "y" | "angle" | "lineWidth";
export type SymbolInstanceAttributeName =
	| NumberField
	| `attributes.${keyof SymbolInstanceAttributeValues["attributes"]}`
	| `extraAttributes.${number}`;
export type SymbolInstanceAttributeValue<
	Name extends SymbolInstanceAttributeName,
> = Name extends "lineWidth"
	? number | null
	: Name extends NumberField
		? number
		: string;

type FieldValue = string | number | null;

function fieldValue(values: SymbolInstanceAttributeValues, name: string) {
	let current: unknown = values;
	for (const part of name.split("."))
		current = (current as Record<string, unknown> | undefined)?.[part];
	return current as FieldValue | undefined;
}

function withField(
	values: SymbolInstanceAttributeValues,
	name: string,
	value: FieldValue,
): SymbolInstanceAttributeValues {
	const next = structuredClone(values) as unknown as Record<string, unknown>;
	const parts = name.split(".");
	let target = next;
	for (const part of parts.slice(0, -1))
		target = target[part] as Record<string, unknown>;
	target[parts[parts.length - 1]] = value;
	return next as unknown as SymbolInstanceAttributeValues;
}

const sameValue = (a: unknown, b: unknown) => Object.is(a, b) || a === b;

const sameValues = (
	a: SymbolInstanceAttributeValues,
	b: SymbolInstanceAttributeValues,
) => JSON.stringify(a) === JSON.stringify(b);

export interface Draft {
	readonly text: string;
	readonly numeric: boolean;
}

const draftValue = ({ text, numeric }: Draft): FieldValue =>
	numeric ? (text.trim() === "" ? Number.NaN : Number(text)) : text;

const formatField = (value: FieldValue | undefined) =>
	value === null || value === undefined ? "" : String(value);

interface SymbolInstanceAttributeFormState {
	shown(name: SymbolInstanceAttributeName): string;
	editing(name: SymbolInstanceAttributeName): boolean;
	error(name: SymbolInstanceAttributeName): string | undefined;
	input(name: SymbolInstanceAttributeName, draft: Draft): void;
	commit(
		name: SymbolInstanceAttributeName,
		entered: FieldValue,
	): { readonly value: FieldValue } | undefined;
}

const FormContext = createContext<SymbolInstanceAttributeFormState>();

export const useSymbolInstanceAttributeForm = () => useContext(FormContext);

function displayNumber(value: number) {
	return Number(value.toFixed(4)) || value;
}

export function SymbolInstanceAttributeForm(props: {
	symbol: EditorSymbol;
	/** Positions in millimetres, for footprints placed on a board. */
	millimetres?: boolean;
	children: JSX.Element;
}) {
	const values = createMemo(
		(): SymbolInstanceAttributeValues => {
			const { symbol } = props;
			const length = props.millimetres ? displayNumber : toMils;
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
		},
		{ equals: sameValues },
	);
	const [form, setForm] = createStore<{
		drafts: Record<string, Draft>;
		defaults: Record<string, FieldValue>;
		errors: Record<string, string>;
	}>({ drafts: {}, defaults: {}, errors: {} });

	const defaultValue = (name: string) =>
		name in form.defaults ? form.defaults[name] : fieldValue(values(), name);
	createEffect(values, (_next, previous) => {
		if (!previous) return;
		setForm((draft) => {
			for (const [name, entered] of Object.entries(draft.drafts)) {
				const committed =
					name in draft.defaults
						? draft.defaults[name]
						: fieldValue(previous, name);
				if (sameValue(draftValue(entered), committed))
					delete draft.drafts[name];
			}
			draft.defaults = {};
		});
	});

	const state: SymbolInstanceAttributeFormState = {
		shown: (name) => formatField(defaultValue(name)),
		editing: (name) => form.drafts[name] !== undefined,
		error: (name) => form.errors[name],
		input(name, draft) {
			setForm((current) => {
				current.drafts[name] = draft;
			});
		},
		commit(name, entered) {
			const draft = form.drafts[name];
			const isDirty =
				draft !== undefined && !sameValue(entered, defaultValue(name));
			if (!isDirty && form.errors[name] === undefined) {
				setForm((current) => {
					delete current.drafts[name];
				});
				return undefined;
			}
			const result = schema.safeParse(withField(values(), name, entered));
			const issue = result.success
				? undefined
				: result.error.issues.find((item) => item.path.join(".") === name);
			if (issue) {
				setForm((current) => {
					current.errors[name] = issue.message;
				});
				return undefined;
			}
			setForm((current) => {
				delete current.errors[name];
				delete current.drafts[name];
				if (isDirty) current.defaults[name] = entered;
			});
			return isDirty ? { value: entered } : undefined;
		},
	};

	return (
		<FormContext value={state}>
			<form
				aria-label="Symbol instance attributes"
				class="contents"
				novalidate
				onSubmit={(event) => event.preventDefault()}
			>
				{props.children}
			</form>
		</FormContext>
	);
}
