import type { TextShape } from "#/drawing/shapes.ts";
import {
	createTextShape as createDrawingTextShape,
	updateText as updateDrawingText,
} from "#/drawing/text.ts";
import type { Point } from "#/drawing/types.ts";
import { measureText } from "#/engine/drawing/text.ts";

export { createTextMaterial } from "#/engine/drawing/text.ts";

export function createTextShape(id: number, center: Point): TextShape {
	return createDrawingTextShape(id, center, measureText);
}

export function updateText(shape: TextShape, text: string): TextShape {
	return updateDrawingText(shape, text, measureText);
}
