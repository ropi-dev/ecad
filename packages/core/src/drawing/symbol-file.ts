import type {
	SymbolFile,
	SymbolLibrary,
} from "#/components/editor/symbolFormat.ts";
import {
	DEFAULT_LINE_WIDTH,
	type EditorShape,
	fitBoxToBorder,
	isBasicShape,
	normalizeNetSymbol,
	PIN_RADIUS,
	symbolShapes,
} from "#/drawing/shapes.ts";
import type { SymbolLibraryReference } from "#/drawing/symbol-reference.ts";
import { createSymbol, type SymbolDefinition } from "#/drawing/symbols.ts";

export type SymbolResolver = (
	library: SymbolLibraryReference,
	id: string,
) => SymbolDefinition | undefined;

/** Keep nested placements intact when opening a definition for editing. */
export function symbolFileShapes(
	file: SymbolFile,
	resolve?: SymbolResolver,
): EditorShape[] {
	let resolvedShapes = 0;
	return file.shapes.map((shape, index): EditorShape => {
		const base = {
			id: index + 1,
			...(shape.locked === undefined ? {} : { locked: shape.locked }),
			lineWidth: shape.lineWidth ?? DEFAULT_LINE_WIDTH,
			...("lineStyle" in shape && shape.lineStyle
				? { lineStyle: shape.lineStyle }
				: {}),
			rotation: 0,
		};
		if (shape.kind === "symbol") {
			if (shape.netSymbol)
				throw new Error(
					"Net symbols cannot be nested inside reusable symbols.",
				);
			const definition = resolve?.(shape.library, shape.definitionId);
			resolvedShapes += definition?.children.length ?? 0;
			if (resolvedShapes > 65_536)
				throw new Error("Resolved symbols may contain at most 65536 shapes.");
			const instance = definition?.children.length
				? createSymbol(
						base.id,
						{ ...definition, netSymbol: undefined },
						{ x: shape.x, y: shape.y },
						shape.attributes?.reference ?? "",
					)
				: {
						...base,
						...shape,
						width: 1,
						height: 1,
						children: [],
						texts: [],
						attributes: shape.attributes ?? {
							name: shape.definitionId,
							reference: "",
							value: "",
						},
					};
			return fitBoxToBorder(
				normalizeNetSymbol({
					...instance,
					...(shape.netSymbol === undefined
						? {}
						: { netSymbol: shape.netSymbol }),
					...(shape.locked === undefined ? {} : { locked: shape.locked }),
					...(shape.childOverrides
						? { childOverrides: structuredClone(shape.childOverrides) }
						: {}),
					library: shape.library,
					definitionId: shape.definitionId,
					rotation: ((shape.rotation ?? 0) * Math.PI) / 180,
					...(shape.attributes ? { attributes: { ...shape.attributes } } : {}),
					...(shape.textAlignments
						? { textAlignments: structuredClone(shape.textAlignments) }
						: {}),
					...(shape.textPositions
						? { textPositions: structuredClone(shape.textPositions) }
						: {}),
					...(shape.lineWidth === undefined
						? {}
						: {
								lineWidth: shape.lineWidth,
								strokeOverride: shape.lineWidth,
								children: instance.children.map((child) => ({
									...child,
									lineWidth:
										child.kind === "text"
											? child.lineWidth
											: (shape.lineWidth ?? child.lineWidth),
								})),
							}),
				}),
				{ preserveChildWorldPositions: true },
			);
		}
		resolvedShapes += 1;
		if (resolvedShapes > 65_536)
			throw new Error("Resolved symbols may contain at most 65536 shapes.");
		if ("x1" in shape) {
			const dx = shape.x2 - shape.x1,
				dy = shape.y2 - shape.y1;
			return {
				...base,
				kind: shape.kind,
				x: (shape.x1 + shape.x2) / 2,
				y: (shape.y1 + shape.y2) / 2,
				width: Math.hypot(dx, dy),
				height: DEFAULT_LINE_WIDTH,
				rotation: Math.atan2(dy, dx),
			};
		}
		if ("radius" in shape)
			return {
				...base,
				kind: shape.kind,
				x: shape.x,
				y: shape.y,
				width: shape.radius * 2,
				height: shape.radius * 2,
				...(shape.filled === undefined ? {} : { filled: shape.filled }),
			};
		if (shape.kind === "pin")
			return {
				...base,
				...shape,
				name: shape.name ?? "",
				number: shape.number ?? "",
				rotation: ((shape.rotation ?? 0) * Math.PI) / 180,
				width: 2 * PIN_RADIUS,
				height: 2 * PIN_RADIUS,
			};
		return {
			...base,
			...shape,
			rotation: ((shape.rotation ?? 0) * Math.PI) / 180,
		};
	});
}

export function libraryDefinitions(
	library: SymbolLibrary,
	resolve?: SymbolResolver,
): SymbolDefinition[] {
	return library.map(
		(
			{
				shapes: _shapes,
				format: _format,
				version: _version,
				units: _units,
				...definition
			},
			index,
		) => ({
			...definition,
			texts: [],
			children: symbolFileShapes(library[index], resolve)
				.flatMap((shape) =>
					shape.kind === "symbol" ? symbolShapes(shape) : [shape],
				)
				.map((shape, index) => ({ ...shape, id: index + 1 })),
		}),
	);
}

/** Keep metadata and the origin while saving primitive shapes and library references. */
export function symbolFileWithShapes(
	file: SymbolFile,
	shapes: EditorShape[],
): SymbolFile {
	return {
		...file,
		shapes: shapes.map((shape): SymbolFile["shapes"][number] => {
			if (shape.kind === "text") {
				const { id: _id, ...text } = shape;
				return {
					...text,
					rotation:
						(((((shape.rotation * 180) / Math.PI) % 360) + 540) % 360) - 180,
				};
			}
			if (shape.kind === "symbol") {
				if (shape.netSymbol)
					throw new Error(
						"Net symbols cannot be nested inside reusable symbols.",
					);
				if (!shape.library)
					throw new Error(
						"Choose a library symbol before saving a nested symbol.",
					);
				return {
					kind: "symbol",
					...(shape.netSymbol === undefined
						? {}
						: { netSymbol: shape.netSymbol }),
					...(shape.locked === undefined ? {} : { locked: shape.locked }),
					...(shape.childOverrides
						? { childOverrides: structuredClone(shape.childOverrides) }
						: {}),
					library: shape.library,
					definitionId: shape.definitionId,
					x: shape.x,
					y: shape.y,
					rotation:
						(((((shape.rotation * 180) / Math.PI) % 360) + 540) % 360) - 180,
					attributes: { ...shape.attributes },
					...(shape.textAlignments
						? { textAlignments: structuredClone(shape.textAlignments) }
						: {}),
					...(shape.textPositions
						? { textPositions: structuredClone(shape.textPositions) }
						: {}),
					...(shape.strokeOverride === undefined
						? {}
						: { lineWidth: shape.strokeOverride }),
				};
			}
			const base = {
				...(shape.locked === undefined ? {} : { locked: shape.locked }),
				lineWidth: shape.lineWidth,
				...(isBasicShape(shape) && shape.filled !== undefined
					? { filled: shape.filled }
					: {}),
				...(isBasicShape(shape) && shape.lineStyle
					? { lineStyle: shape.lineStyle }
					: {}),
			};
			if (shape.kind === "line" || shape.kind === "wire") {
				const dx = (Math.cos(shape.rotation) * shape.width) / 2;
				const dy = (Math.sin(shape.rotation) * shape.width) / 2;
				return {
					...base,
					kind: shape.kind,
					x1: shape.x - dx,
					y1: shape.y - dy,
					x2: shape.x + dx,
					y2: shape.y + dy,
				};
			}
			const position = { x: shape.x, y: shape.y };
			if (shape.kind === "pin")
				return {
					...base,
					kind: shape.kind,
					...position,
					name: shape.name,
					number: shape.number,
					...(shape.length === undefined ? {} : { length: shape.length }),
					...(shape.rotation === 0
						? {}
						: {
								rotation:
									(((((shape.rotation * 180) / Math.PI) % 360) + 540) % 360) -
									180,
							}),
					...(shape.labelOffset === undefined
						? {}
						: { labelOffset: shape.labelOffset }),
					...(shape.showName === undefined ? {} : { showName: shape.showName }),
					...(shape.showNumber === undefined
						? {}
						: { showNumber: shape.showNumber }),
					...(shape.showLabels === undefined
						? {}
						: { showLabels: shape.showLabels }),
				};
			if (shape.kind === "circle")
				return {
					...base,
					kind: shape.kind,
					...position,
					radius: shape.width / 2,
				};
			const degrees = (shape.rotation * 180) / Math.PI;
			return {
				...base,
				kind: shape.kind,
				...position,
				width: shape.width,
				height: shape.height,
				rotation: (((degrees % 360) + 540) % 360) - 180,
			};
		}),
	};
}
