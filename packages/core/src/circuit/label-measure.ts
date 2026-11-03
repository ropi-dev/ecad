import { estimateLabelTextWidth } from "#/circuit/linked-schematic.ts";
import { font } from "#/drawing/text.ts";

let context:
	| OffscreenCanvasRenderingContext2D
	| CanvasRenderingContext2D
	| null = null;

/** Measures net label text on a canvas, or estimates it when no canvas exists. */
export function measureLabelText(text: string): number {
	if (!context) {
		if (typeof OffscreenCanvas !== "undefined")
			context = new OffscreenCanvas(1, 1).getContext("2d");
		else if (typeof document !== "undefined")
			context = document.createElement("canvas").getContext("2d");
	}
	if (!context) return estimateLabelTextWidth(text);
	context.font = font;
	return context.measureText(text).width;
}
