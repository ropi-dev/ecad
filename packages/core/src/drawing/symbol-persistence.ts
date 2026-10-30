import {
	type EditorShape,
	type EditorSymbol,
	fitBoxToBorder,
	normalizeNetSymbol,
} from "#/drawing/shapes.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import { symbolReferenceKey } from "#/drawing/symbol-reference.ts";
import {
	createSymbol,
	type SymbolDefinition,
	symbolDefinitions,
} from "#/drawing/symbols.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import type { ProjectDocument } from "#/projects/format.ts";

function legacyStrokeOverride(
	shape: EditorSymbol,
	definition?: SymbolDefinition,
) {
	if (shape.strokeOverride !== undefined) return shape.strokeOverride;
	if (shape.library || !definition || !shape.children.length) return undefined;
	const width = shape.children[0].lineWidth;
	return shape.children.every((child) => child.lineWidth === width) &&
		definition.children.some((child) => child.lineWidth !== width)
		? width
		: undefined;
}

/** Save instance attributes and label positions without copying library geometry. */
export function persistDrawingShapes(
	shapes: readonly EditorShape[],
	definitions: readonly SymbolDefinition[] = symbolDefinitions,
) {
	const byId = new Map(
		definitions.map((definition) => [definition.id, definition]),
	);
	return shapes.map((shape) => {
		if (shape.kind !== "symbol") return shape;
		const definition = byId.get(shape.definitionId);
		const library = shape.library ?? definition?.library;
		if (!library) return shape;
		const { children: _children, texts: _texts, ...instance } = shape;
		const strokeOverride = legacyStrokeOverride(shape, definition);
		return {
			...instance,
			library,
			...(strokeOverride === undefined ? {} : { strokeOverride }),
		};
	});
}

/** Migrate known inline definitions while preserving legacy symbols with no library. */
export function persistProjectDrawingShapes(document: ProjectDocument) {
	const definitions: SymbolDefinition[] = [
		...symbolDefinitions,
		...libraryDefinitions(document.symbols).map((definition) => ({
			...definition,
			library: { scope: "project" as const, id: "project-symbols" },
		})),
	];
	for (const library of document.symbolLibraries ?? []) {
		if (library.enabled && library.source.kind === "embedded")
			definitions.push(
				...libraryDefinitions(library.source.symbols).map((definition) => ({
					...definition,
					library: { scope: "project" as const, id: library.id },
				})),
			);
	}
	return persistDrawingShapes(document.shapes, definitions);
}

/** Resolve a document for interaction without changing its history or saved data. */
export function resolveDrawingSymbols(
	shapes: EditorShape[],
	definitions: readonly SymbolDefinition[],
	byReference: ReadonlyMap<string, SymbolDefinition>,
): { shapes: EditorShape[]; errors: string[] } {
	return measurePerformance(
		"drawing.resolve-symbols",
		() => {
			const errors = new Set<string>();
			const byId = new Map(
				definitions.map((definition) => [definition.id, definition]),
			);
			return {
				shapes: shapes.map((shape) => {
					if (shape.kind !== "symbol") return shape;
					const definition = shape.library
						? byReference.get(
								symbolReferenceKey(shape.library, shape.definitionId),
							)
						: byId.get(shape.definitionId);
					if (!definition?.children.length) {
						if (!shape.library) return shape; // Preserve legacy inline geometry until its library is available.
						errors.add(
							`Symbol "${shape.definitionId}" is unavailable in library "${shape.library.id}".`,
						);
						return { ...shape, children: [], texts: [] };
					}
					const resolved = createSymbol(
						shape.id,
						{
							...definition,
							netSymbol: shape.netSymbol ?? definition.netSymbol,
						},
						shape,
						shape.attributes.reference,
					);
					const strokeOverride = legacyStrokeOverride(shape, definition);
					return fitBoxToBorder(
						normalizeNetSymbol({
							...shape,
							library: definition.library,
							width: resolved.width,
							height: resolved.height,
							lineWidth: strokeOverride ?? resolved.lineWidth,
							...(strokeOverride === undefined ? {} : { strokeOverride }),
							children:
								strokeOverride === undefined
									? resolved.children
									: resolved.children.map((child) => ({
											...child,
											lineWidth:
												child.kind === "text"
													? child.lineWidth
													: strokeOverride,
										})),
							texts: resolved.texts,
						} satisfies EditorSymbol),
						{ preserveChildWorldPositions: true },
					);
				}),
				errors: [...errors],
			};
		},
		{ shapes: shapes.length },
	);
}
