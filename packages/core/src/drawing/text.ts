import type { TextShape } from "./shapes";
import type { Point } from "./types";

export const fontPixels = 96;
export const padding = 12;
export const lineHeight = 120;
export const font = `${fontPixels}px Arial, sans-serif`;
export type MeasureText = (text: string) => number;

export function textLayout(text: string, measureText: MeasureText) {
	const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
	const width =
		Math.max(fontPixels / 2, ...lines.map(measureText)) + padding * 2;
	const height = lines.length * lineHeight + padding * 2;
	return { lines, width, height };
}

export function updateText(
	shape: TextShape,
	text: string,
	measureText: MeasureText,
): TextShape {
	const layout = textLayout(text, measureText);
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
			lineWidth: 0.2,
			text: "Text",
			fontSize: 5,
			horizontalAlign: "center",
			verticalAlign: "middle",
		},
		"Text",
		measureText,
	);
}
