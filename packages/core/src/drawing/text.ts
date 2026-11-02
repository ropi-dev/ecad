import {
	DEFAULT_STROKE_WIDTH,
	DEFAULT_TEXT_SIZE,
	PIN_NAME_SIZE,
	PIN_NUMBER_SIZE,
} from "#/drawing/units.ts";
import type { TextShape } from "./shapes";
import type { Point } from "./types";

export const fontPixels = 96;
export const padding = 12;
export const lineHeight = 120;
export const font = `${fontPixels}px Arial, sans-serif`;
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
