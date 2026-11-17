import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	footprintLayerLabels,
	footprintLayers,
} from "@ecad/drawing-core/footprint/layers.ts";
import { shapeLayers } from "@ecad/drawing-core/footprint/shapes.ts";
import { zlibSync } from "fflate";
import {
	buildDrawingScene,
	type DrawingScene,
	type DrawingSceneOptions,
	lineStart,
	overbarTop,
	type SceneItem,
} from "#/drawing/export.ts";
import { fontPixels, overbarThickness } from "#/drawing/text.ts";
import outlineData from "#/engine/drawing/fonts/jetbrains-mono-outlines.json";
import { measurePerformance } from "#/performance/runtime.ts";

type Weight = "400" | "700";

interface GlyphOutlines {
	unitsPerEm: number;
	advance: number;
	weights: Record<
		Weight,
		{ glyphs: Record<string, string>; advances: Record<string, number> }
	>;
}

export type DrawingPdfOptions = Omit<DrawingSceneOptions, "layer"> & {
	title: string;
	layers?: boolean;
};

const outlines = outlineData as GlyphOutlines;
const pointsPerMillimetre = 72 / 25.4;
const largestPage = 14400;
const glyphsPerFont = 255;
const worksheetStroke = 0.15;
const centralBaseline = 0.36;
const captionSize = 2;
const captionInset = 1;
const encoder = new TextEncoder();

const n = (value: number) => String(Math.round(value * 1e4) / 1e4);
const fine = (value: number) => value.toFixed(8).replace(/\.?0+$/, "");

function rgb(color: string) {
	if (color === "white") return [1, 1, 1];
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
	if (!hex) return [0, 0, 0];
	const full =
		hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
	return [0, 2, 4].map(
		(offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255,
	);
}

const fillColor = (color: string) =>
	`${rgb(color)
		.map((part) => n(part))
		.join(" ")} rg`;
const strokeColor = (color: string) =>
	`${rgb(color)
		.map((part) => n(part))
		.join(" ")} RG`;

const advance = (codePoint: number, weight: Weight) =>
	outlines.weights[weight].advances[codePoint] ?? outlines.advance;

function glyphProcedure(codePoint: number, weight: Weight) {
	const width = advance(codePoint, weight);
	const path = outlines.weights[weight].glyphs[codePoint];
	if (!path) return `${width} 0 0 0 0 0 d1`;
	const operations: string[] = [];
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	let left = Infinity;
	let bottom = Infinity;
	let right = -Infinity;
	let top = -Infinity;
	const visit = (px: number, py: number) => {
		left = Math.min(left, px);
		right = Math.max(right, px);
		bottom = Math.min(bottom, py);
		top = Math.max(top, py);
		return `${n(px)} ${n(py)}`;
	};
	const tokens = path.match(/[mlqz]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
	let index = 0;
	const next = () => Number(tokens[index++]);
	let command = "";
	while (index < tokens.length) {
		if (/[mlqz]/.test(tokens[index])) command = tokens[index++];
		if (command === "z") {
			operations.push("h");
			x = startX;
			y = startY;
			command = "";
		} else if (command === "m") {
			x += next();
			y += next();
			startX = x;
			startY = y;
			operations.push(`${visit(x, y)} m`);
			command = "l";
		} else if (command === "l") {
			x += next();
			y += next();
			operations.push(`${visit(x, y)} l`);
		} else if (command === "q") {
			const cx = x + next();
			const cy = y + next();
			const ex = x + next();
			const ey = y + next();
			operations.push(
				`${visit(x + ((cx - x) * 2) / 3, y + ((cy - y) * 2) / 3)} ${visit(ex + ((cx - ex) * 2) / 3, ey + ((cy - ey) * 2) / 3)} ${visit(ex, ey)} c`,
			);
			x = ex;
			y = ey;
		} else index++;
	}
	if (!Number.isFinite(left)) return `${width} 0 0 0 0 0 d1`;
	return `${width} 0 ${Math.floor(left)} ${Math.floor(bottom)} ${Math.ceil(right)} ${Math.ceil(top)} d1\n${operations.join("\n")}\nf`;
}

interface Type3Font {
	name: string;
	weight: Weight;
	codePoints: number[];
}

class GlyphFonts {
	readonly fonts: Type3Font[] = [];
	private readonly codes = new Map<string, { font: Type3Font; code: number }>();
	private readonly filling: Partial<Record<Weight, Type3Font>> = {};

	glyph(codePoint: number, weight: Weight) {
		const key = `${weight}:${codePoint}`;
		let glyph = this.codes.get(key);
		if (!glyph) {
			let font = this.filling[weight];
			if (!font || font.codePoints.length >= glyphsPerFont) {
				font = { name: `F${this.fonts.length + 1}`, weight, codePoints: [] };
				this.fonts.push(font);
				this.filling[weight] = font;
			}
			font.codePoints.push(codePoint);
			glyph = { font, code: font.codePoints.length };
			this.codes.set(key, glyph);
		}
		return glyph;
	}

	show(text: string, weight: Weight, size: number) {
		const operations: string[] = [];
		let font: Type3Font | undefined;
		let hex = "";
		const flush = () => {
			if (font && hex)
				operations.push(`/${font.name} ${n(size)} Tf <${hex}> Tj`);
			hex = "";
		};
		for (const character of text) {
			const glyph = this.glyph(character.codePointAt(0) ?? 0, weight);
			if (glyph.font !== font) {
				flush();
				font = glyph.font;
			}
			hex += glyph.code.toString(16).padStart(2, "0");
		}
		flush();
		return operations.join(" ");
	}
}

const textWidth = (text: string, weight: Weight, size: number) => {
	let width = 0;
	for (const character of text)
		width += advance(character.codePointAt(0) ?? 0, weight);
	return (width * size) / outlines.unitsPerEm;
};

function utf16Hex(text: string) {
	let hex = "";
	for (let i = 0; i < text.length; i++)
		hex += text.charCodeAt(i).toString(16).padStart(4, "0");
	return hex;
}

function toUnicode(codePoints: readonly number[]) {
	const entries = codePoints.map(
		(codePoint, index) =>
			`<${(index + 1).toString(16).padStart(2, "0")}> <${utf16Hex(String.fromCodePoint(codePoint))}>`,
	);
	const blocks: string[] = [];
	for (let i = 0; i < entries.length; i += 100) {
		const block = entries.slice(i, i + 100);
		blocks.push(`${block.length} beginbfchar\n${block.join("\n")}\nendbfchar`);
	}
	return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<00> <FF>
endcodespacerange
${blocks.join("\n")}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

class PdfDocument {
	private readonly objects: Uint8Array[] = [];

	reserve() {
		this.objects.push(new Uint8Array());
		return this.objects.length;
	}

	set(id: number, dictionary: string, stream?: string) {
		const head = `${id} 0 obj\n`;
		if (stream === undefined) {
			this.objects[id - 1] = encoder.encode(`${head}${dictionary}\nendobj\n`);
			return id;
		}
		const data = zlibSync(encoder.encode(stream));
		const start = encoder.encode(
			`${head}${dictionary.slice(0, -2)} /Length ${data.length} /Filter /FlateDecode >>\nstream\n`,
		);
		const end = encoder.encode("\nendstream\nendobj\n");
		const object = new Uint8Array(start.length + data.length + end.length);
		object.set(start);
		object.set(data, start.length);
		object.set(end, start.length + data.length);
		this.objects[id - 1] = object;
		return id;
	}

	add(dictionary: string, stream?: string) {
		return this.set(this.reserve(), dictionary, stream);
	}

	bytes(root: number, info: number): Uint8Array<ArrayBuffer> {
		const header = new Uint8Array([
			...encoder.encode("%PDF-1.4\n%"),
			0xe2,
			0xe3,
			0xcf,
			0xd3,
			0x0a,
		]);
		const offsets: number[] = [];
		let length = header.length;
		for (const object of this.objects) {
			offsets.push(length);
			length += object.length;
		}
		const trailer = encoder.encode(
			`xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n${offsets
				.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
				.join(
					"",
				)}trailer\n<< /Size ${this.objects.length + 1} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${length}\n%%EOF\n`,
		);
		const output = new Uint8Array(length + trailer.length);
		output.set(header);
		let offset = header.length;
		for (const object of this.objects) {
			output.set(object, offset);
			offset += object.length;
		}
		output.set(trailer, offset);
		return output;
	}
}

function addFont(pdf: PdfDocument, font: Type3Font) {
	const procedures = font.codePoints.map(
		(codePoint, index) =>
			`/g${index + 1} ${pdf.add("<< >>", glyphProcedure(codePoint, font.weight))} 0 R`,
	);
	const unicode = pdf.add("<< >>", toUnicode(font.codePoints));
	const scale = n(1 / outlines.unitsPerEm);
	const { unitsPerEm } = outlines;
	return pdf.add(
		`<< /Type /Font /Subtype /Type3 /FontBBox [0 ${-unitsPerEm} ${unitsPerEm} ${unitsPerEm * 1.5}] /FontMatrix [${scale} 0 0 ${scale} 0 0] /CharProcs << ${procedures.join(" ")} >> /Encoding << /Type /Encoding /Differences [1 ${font.codePoints.map((_, index) => `/g${index + 1}`).join(" ")}] >> /FirstChar 1 /LastChar ${font.codePoints.length} /Widths [${font.codePoints.map((codePoint) => advance(codePoint, font.weight)).join(" ")}] /ToUnicode ${unicode} 0 R /Resources << >> >>`,
	);
}

function itemContent(item: SceneItem, fonts: GlyphFonts) {
	if (item.kind === "triangles") {
		const { points } = item;
		const parts: string[] = [];
		for (let i = 0; i + 5 < points.length; i += 6)
			parts.push(
				`${n(points[i])} ${n(points[i + 1])} m ${n(points[i + 2])} ${n(points[i + 3])} l ${n(points[i + 4])} ${n(points[i + 5])} l h`,
			);
		return `${parts.join("\n")}\nf`;
	}
	if (item.kind !== "text") return "";
	const [a, b, c, d, e, f] = item.matrix;
	if (!(Math.abs(a * d - b * c) > 1e-12)) return "";
	const weight: Weight = item.bold ? "700" : "400";
	const text: string[] = [];
	const bars: string[] = [];
	for (const line of item.lines) {
		const start = lineStart(item.x, line.width, item.align);
		if (line.text) {
			const natural = textWidth(line.text, weight, fontPixels);
			const stretch = natural > 0 ? line.width / natural : 1;
			text.push(
				`${fine(stretch)} 0 0 -1 ${n(start)} ${n(line.baseline)} Tm ${fonts.show(line.text, weight, fontPixels)}`,
			);
		}
		const top = overbarTop(line.baseline);
		for (const [from, to] of line.overbars)
			bars.push(
				`${n(start + from)} ${n(top)} ${n(to - from)} ${n(overbarThickness)} re`,
			);
	}
	return `q ${[a, b, c, d, e, f].map(fine).join(" ")} cm${text.length ? `\nBT\n${text.join("\n")}\nET` : ""}${bars.length ? `\n${bars.join("\n")}\nf` : ""}\nQ`;
}

interface PdfPage {
	label?: string;
	scene: DrawingScene;
}

function layerPages(
	shapes: EditorShape[],
	options: DrawingPdfOptions,
): PdfPage[] {
	const layers = shapes.map(shapeLayers);
	const pages = footprintLayers.flatMap((layer): PdfPage[] => {
		if (
			layer === "Edge.Cuts" ||
			!layers.some((onLayers) => onLayers.includes(layer))
		)
			return [];
		return [
			{
				label: footprintLayerLabels[layer],
				scene: buildDrawingScene(
					shapes.filter(
						(_, index) =>
							layers[index].includes(layer) ||
							layers[index].includes("Edge.Cuts"),
					),
					{ ...options, layer },
				),
			},
		];
	});
	if (!pages.length) return [{ scene: buildDrawingScene(shapes, options) }];
	const left = Math.min(...pages.map(({ scene }) => scene.view.x));
	const top = Math.min(...pages.map(({ scene }) => scene.view.y));
	const right = Math.max(
		...pages.map(({ scene }) => scene.view.x + scene.view.width),
	);
	const bottom = Math.max(
		...pages.map(({ scene }) => scene.view.y + scene.view.height),
	);
	const caption =
		Math.max(
			...pages.map(({ label = "" }) => textWidth(label, "700", captionSize)),
		) +
		2 * captionInset;
	const widen = Math.max(0, caption - (right - left)) / 2;
	const view = {
		x: left - widen,
		y: top,
		width: right - left + 2 * widen,
		height: bottom - top,
	};
	return pages.map((page) => ({ ...page, scene: { ...page.scene, view } }));
}

function pageContent(
	{ label, scene }: PdfPage,
	scale: number,
	fonts: GlyphFonts,
) {
	const { view } = scene;
	const content: string[] = [
		`${n(scale)} 0 0 ${n(scale)} ${n(-view.x * scale)} ${n((view.y + view.height) * scale)} cm`,
	];
	if (scene.paper)
		content.push(
			`${fillColor(scene.paper)} ${n(view.x)} ${n(-view.y - view.height)} ${n(view.width)} ${n(view.height)} re f`,
		);
	if (scene.worksheet) {
		const { frame, labels } = scene.worksheet;
		const segments: string[] = [];
		for (let i = 0; i + 1 < frame.length; i += 2)
			segments.push(
				`${n(frame[i].x)} ${n(frame[i].y)} m ${n(frame[i + 1].x)} ${n(frame[i + 1].y)} l`,
			);
		content.push(
			`${strokeColor(scene.sheetColor)} ${worksheetStroke} w\n${segments.join("\n")}\nS`,
		);
		if (labels.length)
			content.push(
				`${fillColor(scene.sheetColor)}\nBT\n${labels
					.map((label) => {
						const width = textWidth(label.text, "400", label.fontSize);
						const x = label.align === "center" ? label.x - width / 2 : label.x;
						return `1 0 0 1 ${n(x)} ${n(label.y - centralBaseline * label.fontSize)} Tm ${fonts.show(label.text, "400", label.fontSize)}`;
					})
					.join("\n")}\nET`,
			);
	}
	if (label)
		content.push(
			`${fillColor(scene.layerColor ?? scene.sheetColor)}\nBT\n1 0 0 1 ${n(view.x + captionInset)} ${n(-view.y - captionInset - captionSize * 0.75)} Tm ${fonts.show(label, "700", captionSize)}\nET`,
		);
	let color = "";
	for (const item of scene.items) {
		const operations = itemContent(item, fonts);
		if (!operations) continue;
		if (item.color !== color) {
			color = item.color;
			content.push(fillColor(color));
		}
		content.push(operations);
	}
	return content.join("\n");
}

export function exportDrawingPdf(
	shapes: EditorShape[],
	options: DrawingPdfOptions,
): Uint8Array<ArrayBuffer> {
	return measurePerformance(
		"drawing.export-pdf",
		() => {
			const pages = options.layers
				? layerPages(shapes, options)
				: [{ scene: buildDrawingScene(shapes, options) }];
			const { view } = pages[0].scene;
			const scale = Math.min(
				pointsPerMillimetre,
				largestPage / view.width,
				largestPage / view.height,
			);
			const fonts = new GlyphFonts();
			const contents = pages.map((page) => pageContent(page, scale, fonts));

			const pdf = new PdfDocument();
			const catalog = pdf.reserve();
			const tree = pdf.reserve();
			const fontResources = fonts.fonts.map(
				(font) => `/${font.name} ${addFont(pdf, font)} 0 R`,
			);
			const pageIds = contents.map((content) => {
				const stream = pdf.add("<< >>", content);
				return pdf.add(
					`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${n(view.width * scale)} ${n(view.height * scale)}] /Resources << /Font << ${fontResources.join(" ")} >> >> /Contents ${stream} 0 R >>`,
				);
			});
			pdf.set(
				tree,
				`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
			);
			const labelled = pages.flatMap((page, index) =>
				page.label ? [{ label: page.label, page: pageIds[index] }] : [],
			);
			if (labelled.length) {
				const outlines = pdf.reserve();
				const entries = labelled.map(() => pdf.reserve());
				for (const [index, { label, page }] of labelled.entries())
					pdf.set(
						entries[index],
						`<< /Title <feff${utf16Hex(label)}> /Parent ${outlines} 0 R${index ? ` /Prev ${entries[index - 1]} 0 R` : ""}${index + 1 < entries.length ? ` /Next ${entries[index + 1]} 0 R` : ""} /Dest [${page} 0 R /Fit] >>`,
					);
				pdf.set(
					outlines,
					`<< /Type /Outlines /First ${entries[0]} 0 R /Last ${entries[entries.length - 1]} 0 R /Count ${entries.length} >>`,
				);
				pdf.set(
					catalog,
					`<< /Type /Catalog /Pages ${tree} 0 R /Outlines ${outlines} 0 R /PageMode /UseOutlines >>`,
				);
			} else pdf.set(catalog, `<< /Type /Catalog /Pages ${tree} 0 R >>`);
			const info = pdf.add(
				`<< /Title <feff${utf16Hex(options.title)}> /Producer (ECAD) >>`,
			);
			return pdf.bytes(catalog, info);
		},
		{ shapes: shapes.length },
	);
}
