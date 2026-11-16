import {
	generateDefaultSymbols,
	type SymbolCategory,
	type SymbolPackaging,
} from "@ecad/default-symbols";
import {
	type EditorShape,
	type EditorSymbol,
	fitBoxToBorder,
	normalizeNetSymbol,
	PIN_RADIUS,
	type SymbolShape,
	type SymbolText,
	shapeBounds,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { extraAttributes } from "@ecad/drawing-core/drawing/symbol-attributes.ts";
import type { SymbolLibraryReference } from "@ecad/drawing-core/drawing/symbol-reference.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import type { FootprintReference } from "@ecad/drawing-core/footprint/reference.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export interface SymbolDefinition {
	id: string;
	library?: SymbolLibraryReference;
	category?: SymbolCategory;
	packaging?: SymbolPackaging;
	name: string;
	description: string;
	prefix: string;
	value: string;
	netSymbol?: boolean;
	footprint?: FootprintReference;
	attributes?: Readonly<Record<string, string>>;
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
	...(generatedSymbols[index].packaging
		? { packaging: generatedSymbols[index].packaging }
		: {}),
	texts: generatedSymbols[index].texts,
}));

export const builtinSymbolFiles: ReadonlyMap<
	string,
	(typeof generatedSymbols)[number]["file"]
> = new Map(generatedSymbols.map(({ file }) => [file.id, file]));

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
	return fitBoxToBorder(
		normalizeNetSymbol({
			id,
			kind: "symbol",
			definitionId: definition.id,
			...(definition.netSymbol === undefined
				? {}
				: { netSymbol: definition.netSymbol }),
			...(definition.library ? { library: definition.library } : {}),
			...(definition.footprint
				? { footprint: { ...definition.footprint } }
				: {}),
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
			attributes: {
				name: definition.name,
				reference,
				value: definition.value,
				...Object.fromEntries(extraAttributes(definition.attributes)),
			},
		}),
	);
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
		attributes: {
			...symbol.attributes,
			reference: symbol.netSymbol ? "" : `${prefix}${suffix}`,
		},
	};
}

export { createSymbolFromShapes } from "@ecad/drawing-core/drawing/group-symbol.ts";
