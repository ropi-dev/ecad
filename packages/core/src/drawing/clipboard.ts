import { z } from "zod";
import {
	createEmptySymbolFile,
	parseSymbolFile,
	symbolFileFromSymbol,
} from "#/components/editor/symbolFormat.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import {
	type EditorShape,
	symbolShapes,
	symbolTextShapes,
} from "#/drawing/shapes.ts";
import {
	libraryDefinitions,
	symbolFileWithShapes,
} from "#/drawing/symbol-file.ts";
import { createSymbol, duplicateSymbol } from "#/drawing/symbols.ts";
import type { Point } from "#/drawing/types.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export const drawingClipboardType = "application/x-ecad-shapes+json";

const clipboardSchema = z.strictObject({
	format: z.literal("ecad-selection"),
	version: z.literal(1),
	shapes: z.array(drawingShapeSchema).min(1).max(10_000),
});

export function selectionFileText(shapes: readonly EditorShape[]): string {
	if (shapes.length === 1 && shapes[0].kind === "symbol") {
		const symbol = shapes[0];
		try {
			const file = symbolFileFromSymbol({
				...symbol,
				definitionId: `clipboard.${crypto.randomUUID()}`,
			});
			const prefix = symbol.attributes.reference.replace(/\d+$/, "");
			return JSON.stringify(
				{
					...file,
					...(/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(prefix) ? { prefix } : {}),
					...(symbol.netSymbol === undefined
						? {}
						: { netSymbol: symbol.netSymbol }),
				},
				null,
				2,
			);
		} catch {}
	}
	return JSON.stringify({ shapes }, null, 2);
}

export function serializeSelection(shapes: readonly EditorShape[]): string {
	return measurePerformance(
		"drawing.clipboard-copy",
		() => {
			const definitions = new Map<string, string>();
			return JSON.stringify({
				format: "ecad-selection",
				version: 1,
				shapes: shapes.map((shape) => {
					if (shape.kind !== "symbol" || shape.library?.id === "builtin")
						return shape;
					const key = JSON.stringify([shape.library, shape.definitionId]);
					let id = definitions.get(key);
					if (!id) {
						id = `clipboard.${crypto.randomUUID()}`;
						definitions.set(key, id);
					}
					const { library: _library, ...inline } = shape;
					return { ...inline, definitionId: id };
				}),
			});
		},
		{ shapes: shapes.length },
	);
}

export function parseSelection(text: string): EditorShape[] | null {
	if (text.length > 10_000_000) return null;
	try {
		const value = JSON.parse(text);
		if (value?.format === "ecad-symbol") {
			const definition = libraryDefinitions([parseSymbolFile(text)])[0];
			return [createSymbol(1, definition, { x: 0, y: 0 })];
		}
		const result = clipboardSchema.safeParse(
			value?.format === undefined && value?.shapes
				? { format: "ecad-selection", version: 1, shapes: value.shapes }
				: value,
		);
		if (!result.success) return null;
		const shapes = result.data.shapes;
		return new Set(shapes.map((shape) => shape.id)).size === shapes.length
			? shapes
			: null;
	} catch {
		return null;
	}
}

/** Why copied drawing data cannot be pasted. Other clipboard text has no error. */
export function selectionPasteError(text: string): string | undefined {
	if (text.length > 10_000_000) return;
	try {
		const value = JSON.parse(text);
		if (value?.format !== "ecad-selection") return;
		const issue = clipboardSchema.safeParse(value).error?.issues[0];
		if (!issue) return;
		// Report shape problems the way drawing commands do, relative to the shape.
		const path = (issue.path[0] === "shapes" ? issue.path.slice(2) : issue.path)
			.map(String)
			.join(".");
		return path ? `${path}: ${issue.message}` : issue.message;
	} catch {
		return;
	}
}

export function pasteSelection(
	source: readonly EditorShape[],
	existing: readonly EditorShape[],
	nextId: number,
	offset: Point,
	destination: "drawing" | "symbol" = "drawing",
): EditorShape[] {
	return measurePerformance(
		"drawing.clipboard-paste",
		() => {
			if (
				destination === "symbol" &&
				source.some(
					(shape) =>
						(shape.kind === "text" && shape.electrical) ||
						(shape.kind === "symbol" && shape.netSymbol),
				)
			)
				throw new Error(
					"Net labels, supply labels and net symbols cannot be pasted into reusable symbols.",
				);
			const insertable =
				destination === "symbol"
					? source.flatMap((shape): EditorShape[] =>
							shape.kind === "symbol" && !shape.library
								? [
										...symbolShapes(shape),
										...symbolTextShapes(shape).map((text) => ({
											...text,
											lineWidth: shape.lineWidth,
											...(shape.locked ? { locked: true } : {}),
										})),
									]
								: [shape],
						)
					: source;
			const pasted: EditorShape[] = [];
			for (const shape of insertable) {
				const id = nextId++;
				const copy =
					shape.kind === "symbol"
						? duplicateSymbol(shape, id, [...existing, ...pasted])
						: { ...structuredClone(shape), id };
				if (copy.kind === "text") delete copy.circuitNet;
				pasted.push({ ...copy, x: copy.x + offset.x, y: copy.y + offset.y });
			}
			if (destination === "symbol")
				parseSymbolFile(
					JSON.stringify(
						symbolFileWithShapes(createEmptySymbolFile("Clipboard paste", []), [
							...existing,
							...pasted,
						]),
					),
				);
			return pasted;
		},
		{ shapes: source.length },
	);
}
