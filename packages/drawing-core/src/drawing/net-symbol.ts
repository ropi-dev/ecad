import type { EditorSymbol } from "#/drawing/schema.ts";
import { shapeBounds } from "#/drawing/shape-geometry.ts";
import { SYMBOL_TEXT_SIZE } from "#/drawing/units.ts";

export function normalizeNetSymbol<T extends EditorSymbol>(symbol: T): T {
	if (!symbol.netSymbol) return symbol;
	const hasValueLabel = symbol.texts.some(
		(label) => label.attribute === "value",
	);
	const hasNameLabel = symbol.texts.some((label) => label.attribute === "name");
	const hasValue = Boolean(
		symbol.attributes.value.trim() ||
			symbol.textPositions?.value ||
			symbol.textAlignments?.value ||
			symbol.childOverrides?.["attribute:value"],
	);
	const source =
		hasValueLabel || (!hasNameLabel && hasValue) ? "value" : "name";
	const label = symbol.texts.find((label) => label.attribute === source) ?? {
		attribute: "name" as const,
		x: 0,
		y:
			Math.min(0, ...symbol.children.map((child) => shapeBounds(child).minY)) -
			SYMBOL_TEXT_SIZE,
		fontSize: SYMBOL_TEXT_SIZE,
	};
	const name = symbol.attributes.value.trim()
		? symbol.attributes.value
		: symbol.attributes.name;
	const position = symbol.textPositions?.[source] ?? symbol.textPositions?.name;
	const alignment =
		symbol.textAlignments?.[source] ?? symbol.textAlignments?.name;
	const attributeOverride =
		symbol.childOverrides?.[`attribute:${source}`] ??
		symbol.childOverrides?.["attribute:name"];
	return {
		...symbol,
		attributes: { name, reference: "", value: "" },
		texts: [{ ...label, attribute: "name" }],
		textPositions: position ? { name: position } : undefined,
		textAlignments: alignment ? { name: alignment } : undefined,
		childOverrides: symbol.childOverrides
			? {
					...Object.fromEntries(
						Object.entries(symbol.childOverrides).filter(
							([key]) => !key.startsWith("attribute:"),
						),
					),
					...(attributeOverride ? { "attribute:name": attributeOverride } : {}),
				}
			: undefined,
	};
}
