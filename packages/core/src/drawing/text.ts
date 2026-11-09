import type { TextShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	DEFAULT_STROKE_WIDTH,
	DEFAULT_TEXT_SIZE,
	PIN_NAME_SIZE,
	PIN_NUMBER_SIZE,
} from "@ecad/drawing-core/drawing/units.ts";

export const fontPixels = 96;
export const padding = 12;
export const lineHeight = 120;
/** Schematic text uses one bundled monospace face so widths match on every machine. */
export const drawingFontFamily = "JetBrains Mono";
export const drawingFontStack = `'${drawingFontFamily}', ui-monospace, monospace`;
export const font = `${fontPixels}px ${drawingFontStack}`;
export const boldFont = `bold ${font}`;
export const pinNameFontSize = PIN_NAME_SIZE;
export const pinNumberFontSize = PIN_NUMBER_SIZE;
export type MeasureText = (text: string, bold?: boolean) => number;

export function textLayout(
	text: string,
	measureText: MeasureText,
	bold?: boolean,
) {
	const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
	const width =
		Math.max(fontPixels / 2, ...lines.map((line) => measureText(line, bold))) +
		padding * 2;
	const height = lines.length * lineHeight + padding * 2;
	return { lines, width, height };
}

export function updateText(
	shape: TextShape,
	text: string,
	measureText: MeasureText,
): TextShape {
	const layout = textLayout(text, measureText, shape.bold);
	return {
		...shape,
		text,
		width: (layout.width * shape.fontSize) / fontPixels,
		height: (layout.height * shape.fontSize) / fontPixels,
	};
}

const fitted = new WeakMap<TextShape, TextShape>();

/**
 * Re-measures a text box for the current drawing font. Drawings saved with an
 * earlier font keep their glyph proportions instead of stretching to the old box.
 */
export function fitTextShape(
	shape: TextShape,
	measureText: MeasureText,
): TextShape {
	const cached = fitted.get(shape);
	if (cached) return cached;
	const next = updateText(shape, shape.text, measureText);
	const result =
		Math.abs(next.width - shape.width) < 1e-6 &&
		Math.abs(next.height - shape.height) < 1e-6
			? shape
			: next;
	fitted.set(shape, result);
	return result;
}

export function createTextShape(
	id: number,
	center: Point,
	measureText: MeasureText,
): TextShape {
	return updateText(
		{
			id,
			kind: "text",
			...center,
			width: 1,
			height: 1,
			rotation: 0,
			lineWidth: DEFAULT_STROKE_WIDTH,
			text: "Text",
			fontSize: DEFAULT_TEXT_SIZE,
			horizontalAlign: "center",
			verticalAlign: "middle",
		},
		"Text",
		measureText,
	);
}
