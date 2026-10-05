import { CanvasTexture, MeshBasicMaterial, SRGBColorSpace } from "three";
import { font, lineHeight, padding, textLayout } from "#/drawing/text.ts";

let measureContext: CanvasRenderingContext2D | null = null;

/** Browser measurement adapter shared by editor text sizing and glyph textures. */
export function measureText(text: string): number {
	measureContext ??= document.createElement("canvas").getContext("2d");
	if (!measureContext) throw new Error("Text drawing is unavailable.");
	measureContext.font = font;
	return measureContext.measureText(text).width;
}

/** One transparent glyph texture per text object, reused through moves and resizing. */
export function createTextMaterial(text: string) {
	const layout = textLayout(text, measureText);
	const scale = Math.min(1, 4096 / layout.width, 4096 / layout.height);
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.ceil(layout.width * scale));
	canvas.height = Math.max(1, Math.ceil(layout.height * scale));
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Text drawing is unavailable.");
	context.scale(canvas.width / layout.width, canvas.height / layout.height);
	context.font = font;
	context.textBaseline = "top";
	context.fillStyle = "white";
	for (const [index, line] of layout.lines.entries())
		context.fillText(line, padding, padding + index * lineHeight);
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	const material = new MeshBasicMaterial({
		map: texture,
		transparent: true,
		depthTest: false,
		depthWrite: false,
	});
	return {
		material,
		dispose: () => {
			material.dispose();
			texture.dispose();
		},
	};
}
