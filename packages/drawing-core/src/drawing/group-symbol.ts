import {
	type EditorSymbol,
	type SymbolShape,
	shapeBounds,
} from "#/drawing/shapes.ts";
import type { SymbolLibraryReference } from "#/drawing/symbol-reference.ts";

/** Group existing geometry without fitting, snapping, or changing its stroke. */
export function createSymbolFromShapes(
	id: number,
	shapes: readonly SymbolShape[],
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
