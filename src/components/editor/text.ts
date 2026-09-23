import { CanvasTexture, MeshBasicMaterial, SRGBColorSpace } from "three";
import type { Point } from "#/engine/types";
import type { TextShape } from "./shapes";

const fontPixels = 96;
const padding = 12;
const lineHeight = 120;
const font = `${fontPixels}px Arial, sans-serif`;
let measureContext: CanvasRenderingContext2D | null = null;

function textLayout(text: string) {
	measureContext ??= document.createElement("canvas").getContext("2d");
	if (!measureContext) throw new Error("Text drawing is unavailable.");
	const context = measureContext;
	context.font = font;
	const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
	const width =
		Math.max(
			fontPixels / 2,
			...lines.map((line) => context.measureText(line).width),
		) +
		padding * 2;
	const height = lines.length * lineHeight + padding * 2;
	return { lines, width, height };
}

export function updateText(shape: TextShape, text: string): TextShape {
	const layout = textLayout(text);
	return {
		...shape,
		text,
		width: (layout.width * shape.fontSize) / fontPixels,
		height: (layout.height * shape.fontSize) / fontPixels,
	};
}

export function createTextShape(id: number, center: Point): TextShape {
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
		},
		"Text",
	);
}

/** One transparent glyph texture per text object, reused through moves and resizing. */
export function createTextMaterial(text: string) {
	const layout = textLayout(text);
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
