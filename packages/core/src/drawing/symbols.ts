import {
	generateDefaultSymbols,
	type SymbolCategory,
} from "@ecad/default-symbols";
import {
	type EditorShape,
	type EditorSymbol,
	fitBoxToBorder,
	PIN_RADIUS,
	type SymbolShape,
	type SymbolText,
	shapeBounds,
} from "#/drawing/shapes.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import type { SymbolLibraryReference } from "#/drawing/symbol-reference.ts";
import type { Point } from "#/drawing/types.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export interface SymbolDefinition {
	id: string;
	library?: SymbolLibraryReference;
	category?: SymbolCategory;
	name: string;
	description: string;
	prefix: string;
	value: string;
	children: SymbolShape[];
	texts: SymbolText[];
}

const generatedSymbols = measurePerformance(
	"symbol-library.generate",
	generateDefaultSymbols,
);
export const symbolDefinitions: SymbolDefinition[] = libraryDefinitions(
	generatedSymbols.map(({ file }) => file),
).map((definition, index) => ({
	...definition,
	library: { scope: "user", id: "builtin" },
	category: generatedSymbols[index].category,
	texts: generatedSymbols[index].texts,
}));

export function createSymbol(
	id: number,
	definition: SymbolDefinition,
	position: Point,
	reference = `${definition.prefix}${id}`,
): EditorSymbol {
	const children = definition.children.map((child) => ({
		...child,
		...(child.kind === "pin"
			? { width: 2 * PIN_RADIUS, height: 2 * PIN_RADIUS }
			: {}),
	}));
	const bounds = children.map(shapeBounds);
	return fitBoxToBorder({
		id,
		kind: "symbol",
		definitionId: definition.id,
		...(definition.library ? { library: definition.library } : {}),
		...position,
		width:
			2 *
			Math.max(
				...bounds.flatMap((box) => [Math.abs(box.minX), Math.abs(box.maxX)]),
			),
		height:
			2 *
			Math.max(
				...bounds.flatMap((box) => [Math.abs(box.minY), Math.abs(box.maxY)]),
			),
		rotation: 0,
		lineWidth: children[0].lineWidth,
		children,
		texts: definition.texts.map((label) => ({ ...label })),
		textPositions: Object.fromEntries(
			definition.texts.map(({ attribute, x, y }) => [attribute, { x, y }]),
		),
		attributes: { name: definition.name, reference, value: definition.value },
	});
}

export function duplicateSymbol(
	symbol: EditorSymbol,
	id: number,
	shapes: readonly EditorShape[],
): EditorSymbol {
	const prefix = symbol.attributes.reference.replace(/\d+$/, "");
	const references = new Set(
		shapes.flatMap((shape) =>
			shape.kind === "symbol" ? [shape.attributes.reference] : [],
		),
	);
	let suffix = id;
	while (references.has(`${prefix}${suffix}`)) suffix++;
	return {
		...structuredClone(symbol),
		id,
		attributes: { ...symbol.attributes, reference: `${prefix}${suffix}` },
	};
}

export { createSymbolFromShapes } from "@ecad/drawing-core/drawing/group-symbol.ts";
