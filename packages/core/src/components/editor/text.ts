import type {
	EditorShape,
	TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	createTextShape as createDrawingTextShape,
	fitTextShape,
	updateText as updateDrawingText,
} from "#/drawing/text.ts";
import { measureText } from "#/engine/drawing/text.ts";

export { createTextMaterial } from "#/engine/drawing/text.ts";

export function createTextShape(id: number, center: Point): TextShape {
	return createDrawingTextShape(id, center, measureText);
}

export function updateText(shape: TextShape, text: string): TextShape {
	return updateDrawingText(shape, text, measureText);
}

/** Top-level text boxes refit to the drawing font; unchanged input is returned as is. */
export function fitTextShapes(shapes: EditorShape[]): EditorShape[] {
	let result: EditorShape[] | undefined;
	for (const [index, shape] of shapes.entries()) {
		if (shape.kind !== "text") continue;
		const fitted = fitTextShape(shape, measureText);
		if (fitted === shape) continue;
		result ??= shapes.slice();
		result[index] = fitted;
	}
	return result ?? shapes;
}
