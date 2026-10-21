import {
	generateDefaultSymbols,
	type SymbolCategory,
} from "@ecad/default-symbols";
import {
	type EditorSymbol,
	PIN_RADIUS,
	type PrimitiveShape,
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
	children: PrimitiveShape[];
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
	return {
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
		attributes: { name: definition.name, reference, value: definition.value },
	};
}

/** Group existing geometry without fitting, snapping, or changing its stroke. */
export function createSymbolFromShapes(
	id: number,
	shapes: readonly PrimitiveShape[],
	options: {
		name?: string;
		definitionId?: string;
		library?: SymbolLibraryReference;
	} = {},
): EditorSymbol {
	const bounds = shapes.map(shapeBounds);
	const minX = Math.min(...bounds.map((box) => box.minX));
	const maxX = Math.max(...bounds.map((box) => box.maxX));
	const minY = Math.min(...bounds.map((box) => box.minY));
	const maxY = Math.max(...bounds.map((box) => box.maxY));
	const x = (minX + maxX) / 2;
	const y = (minY + maxY) / 2;
	return {
		id,
		kind: "symbol",
		definitionId: options.definitionId ?? `custom-${id}`,
		...(options.library ? { library: options.library } : {}),
		x,
		y,
		width: maxX - minX,
		height: maxY - minY,
		rotation: 0,
		lineWidth: shapes[0].lineWidth,
		children: shapes.map((shape, index) => ({
			...shape,
			id: index + 1,
			x: shape.x - x,
			y: shape.y - y,
		})),
		texts: [],
		attributes: {
			name: options.name ?? "Custom symbol",
			reference: `U${id}`,
			value: "",
		},
	};
}
