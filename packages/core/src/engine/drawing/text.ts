import {
	CanvasTexture,
	LinearFilter,
	MeshBasicMaterial,
	SRGBColorSpace,
} from "three";
import { font, lineHeight, padding, textLayout } from "#/drawing/text.ts";
import type { TextAlignment } from "#/drawing/text-alignment.ts";

let measureContext: CanvasRenderingContext2D | null = null;

/** Browser measurement adapter shared by editor text sizing and glyph textures. */
export function measureText(text: string): number {
	measureContext ??= document.createElement("canvas").getContext("2d");
	if (!measureContext) throw new Error("Text drawing is unavailable.");
	measureContext.font = font;
	return measureContext.measureText(text).width;
}

function paintText(
	context: CanvasRenderingContext2D,
	layout: ReturnType<typeof textLayout>,
	horizontalAlign?: TextAlignment["horizontalAlign"],
) {
	context.font = font;
	context.textBaseline = "alphabetic";
	context.textAlign = horizontalAlign ?? "left";
	context.fillStyle = "white";
	let top = Infinity;
	let bottom = -Infinity;
	for (const [index, line] of layout.lines.entries()) {
		const metrics = context.measureText(line);
		if (
			metrics.actualBoundingBoxAscent === 0 &&
			metrics.actualBoundingBoxDescent === 0
		)
			continue;
		top = Math.min(top, index * lineHeight - metrics.actualBoundingBoxAscent);
		bottom = Math.max(
			bottom,
			index * lineHeight + metrics.actualBoundingBoxDescent,
		);
	}
	const baseline = Number.isFinite(top)
		? (layout.height - top - bottom) / 2
		: layout.height / 2;
	const x =
		horizontalAlign === "center"
			? layout.width / 2
			: horizontalAlign === "right"
				? layout.width - padding
				: padding;
	for (const [index, line] of layout.lines.entries())
		context.fillText(line, x, baseline + index * lineHeight);
}

/** One transparent glyph texture per text object, reused through moves and resizing. */
export function createTextMaterial(
	text: string,
	horizontalAlign?: TextAlignment["horizontalAlign"],
) {
	const layout = textLayout(text, measureText);
	const scale = Math.min(1, 4096 / layout.width, 4096 / layout.height);
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.ceil(layout.width * scale));
	canvas.height = Math.max(1, Math.ceil(layout.height * scale));
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Text drawing is unavailable.");
	context.scale(canvas.width / layout.width, canvas.height / layout.height);
	paintText(context, layout, horizontalAlign);
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

export function createTextAtlas(values: readonly string[]) {
	const pages: {
		width: number;
		height: number;
		x: number;
		y: number;
		rowHeight: number;
		entries: {
			text: string;
			x: number;
			y: number;
			width: number;
			height: number;
		}[];
	}[] = [];
	for (const text of values) {
		const layout = textLayout(text, measureText);
		const width = Math.min(4096, Math.ceil(layout.width / 2));
		const height = Math.min(4096, Math.ceil(layout.height / 2));
		let page = pages.at(-1);
		if (page && page.x + width > 4096) {
			page.x = 0;
			page.y += page.rowHeight;
			page.rowHeight = 0;
		}
		if (!page || page.y + height > 4096) {
			page = { width: 0, height: 0, x: 0, y: 0, rowHeight: 0, entries: [] };
			pages.push(page);
		}
		page.entries.push({ text, x: page.x, y: page.y, width, height });
		page.x += width;
		page.rowHeight = Math.max(page.rowHeight, height);
		page.width = Math.max(page.width, page.x);
		page.height = Math.max(page.height, page.y + height);
	}
	const entries = new Map<string, { texture: CanvasTexture; uv: number[] }>();
	const textures: CanvasTexture[] = [];
	try {
		for (const page of pages) {
			const canvas = document.createElement("canvas");
			canvas.width = page.width;
			canvas.height = page.height;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Text drawing is unavailable.");
			const texture = new CanvasTexture(canvas);
			texture.colorSpace = SRGBColorSpace;
			texture.generateMipmaps = false;
			texture.minFilter = LinearFilter;
			textures.push(texture);
			for (const entry of page.entries) {
				const layout = textLayout(entry.text, measureText);
				context.save();
				context.translate(entry.x, entry.y);
				context.scale(entry.width / layout.width, entry.height / layout.height);
				paintText(context, layout);
				context.restore();
				entries.set(entry.text, {
					texture,
					uv: [
						entry.x / page.width,
						1 - (entry.y + entry.height) / page.height,
						(entry.x + entry.width) / page.width,
						1 - entry.y / page.height,
					],
				});
			}
		}
	} catch (error) {
		for (const texture of textures) texture.dispose();
		throw error;
	}
	return {
		entries,
		dispose: () => {
			for (const texture of textures) texture.dispose();
		},
	};
}
