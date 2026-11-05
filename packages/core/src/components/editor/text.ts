import type { TextShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	createTextShape as createDrawingTextShape,
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
