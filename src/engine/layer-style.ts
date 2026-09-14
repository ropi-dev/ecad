import { parseColor } from "./camera";

export const UNFOCUSED_FILL_OPACITY = 0.15;
export const UNFOCUSED_OUTLINE_OPACITY = 0.2;
/** Outline width in CSS pixels, independent of zoom and display density. */
export const UNFOCUSED_OUTLINE_WIDTH = 10;

/** Retain a hint of the layer's hue while blending toward a subdued gray. */
export function mutedLayerColor(color: string): string {
	const channels = parseColor(color);
	return `rgb(${[104, 112, 125]
		.map((gray, index) =>
			Math.round(gray * 0.75 + channels[index] * 255 * 0.25),
		)
		.join(", ")})`;
}
