import { Color, SRGBColorSpace } from "three";

export const UNFOCUSED_FILL_OPACITY = 0.06;
export const UNFOCUSED_OUTLINE_OPACITY = 0.1;
/** Outline width in CSS pixels, independent of zoom and display density. */
export const UNFOCUSED_OUTLINE_WIDTH = 6;

/** A single cool film tone keeps unfocused geometry separate from layer colors. */
export const UNFOCUSED_XRAY_COLOR = "#467386";

/** Keep the layer hue while giving hovered nets a small lift. */
export function hoverLayerColor(color: string): string {
	const highlighted = new Color(color);
	const { h, s, l } = highlighted.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
	return `#${highlighted.setHSL(h, Math.min(1, s + 0.14), Math.min(1, l + 0.1), SRGBColorSpace).getHexString()}`;
}
