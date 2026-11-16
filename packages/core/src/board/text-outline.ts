import type { TextShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { textCenter } from "@ecad/drawing-core/drawing/text-alignment.ts";
import ClipperLib from "clipper-lib";
import { uprightTextRotation } from "#/drawing/display.ts";
import {
	fontPixels,
	lineHeight,
	overbarRise,
	overbarThickness,
	padding,
	textLayout,
} from "#/drawing/text.ts";
import outlineData from "#/engine/drawing/fonts/jetbrains-mono-outlines.json";
import { flattenPath, type MultiPolygon } from "#/engine/geometry.ts";

type Weight = "400" | "700";
type Pair = [number, number];

interface GlyphOutlines {
	unitsPerEm: number;
	advance: number;
	weights: Record<
		Weight,
		{ glyphs: Record<string, string>; advances: Record<string, number> }
	>;
}

interface Glyph {
	contours: Pair[][];
	top: number;
	bottom: number;
}

const font = outlineData as GlyphOutlines;
const unitPixels = fontPixels / font.unitsPerEm;
const thinnestStroke: Record<Weight, number> = { "400": 46, "700": 62 };
const curveTolerance = 1;
const scale = 1e6;
const arcTolerance = 0.002;

export const minimumTextStroke = 0.15;

const weightOf = (bold?: boolean): Weight => (bold ? "700" : "400");

const glyphs = new Map<string, Glyph | null>();

function glyph(codePoint: number, weight: Weight): Glyph | undefined {
	const key = `${weight}:${codePoint}`;
	let cached = glyphs.get(key);
	if (cached === undefined) {
		const path = font.weights[weight].glyphs[codePoint];
		const contours = path
			? flattenPath(path, curveTolerance).map((contour) => contour.points)
			: [];
		const ys = contours.flat().map(([, y]) => y);
		cached = ys.length
			? { contours, top: Math.max(...ys), bottom: Math.min(...ys) }
			: null;
		glyphs.set(key, cached);
	}
	return cached ?? undefined;
}

const advance = (codePoint: number, weight: Weight) =>
	font.weights[weight].advances[codePoint] ?? font.advance;

function measure(text: string, bold?: boolean): number {
	const weight = weightOf(bold);
	let width = 0;
	for (const character of text)
		width += advance(character.codePointAt(0) ?? 0, weight);
	return width * unitPixels;
}

function paintedContours(shape: TextShape) {
	const weight = weightOf(shape.bold);
	const layout = textLayout(shape.text, measure, shape.bold);
	let top = Infinity;
	let bottom = -Infinity;
	for (const [index, line] of layout.lines.entries())
		for (const character of line) {
			const drawn = glyph(character.codePointAt(0) ?? 0, weight);
			if (!drawn) continue;
			top = Math.min(top, index * lineHeight - drawn.top * unitPixels);
			bottom = Math.max(bottom, index * lineHeight - drawn.bottom * unitPixels);
		}
	const baseline = Number.isFinite(top)
		? (layout.height - top - bottom) / 2
		: layout.height / 2;
	const anchor =
		shape.horizontalAlign === "center"
			? layout.width / 2
			: shape.horizontalAlign === "right"
				? layout.width - padding
				: padding;
	const strokes: Pair[][] = [];
	const bars: Pair[][] = [];
	for (const [index, line] of layout.lines.entries()) {
		const y = baseline + index * lineHeight;
		const width = measure(line, shape.bold);
		const left =
			shape.horizontalAlign === "center"
				? anchor - width / 2
				: shape.horizontalAlign === "right"
					? anchor - width
					: anchor;
		let pen = left;
		for (const character of line) {
			const codePoint = character.codePointAt(0) ?? 0;
			const drawn = glyph(codePoint, weight);
			if (drawn)
				for (const contour of drawn.contours)
					strokes.push(
						contour.map(([x, glyphY]) => [
							pen + x * unitPixels,
							y - glyphY * unitPixels,
						]),
					);
			pen += advance(codePoint, weight) * unitPixels;
		}
		for (const [start, end] of layout.overbars[index]) {
			const from = left + measure(line.slice(0, start), shape.bold);
			const to = left + measure(line.slice(0, end), shape.bold);
			const barTop = Math.max(0, y - overbarRise - overbarThickness / 2);
			const barBottom = barTop + overbarThickness;
			bars.push([
				[from, barTop],
				[to, barTop],
				[to, barBottom],
				[from, barBottom],
			]);
		}
	}
	return { layout, strokes, bars };
}

function fromTree(tree: ClipperLib.PolyTree): MultiPolygon {
	const back = (path: ClipperLib.Path): Pair[] =>
		path.map(({ X, Y }) => [X / scale, Y / scale]);
	const polygons: MultiPolygon = [];
	const visit = (outer: ClipperLib.PolyNode) => {
		const holes = outer.Childs();
		polygons.push([
			back(outer.Contour()),
			...holes.map((hole) => back(hole.Contour())),
		]);
		for (const hole of holes) for (const island of hole.Childs()) visit(island);
	};
	for (const outer of tree.Childs()) visit(outer);
	return polygons;
}

export function textPolygons(
	shape: TextShape,
	{
		mirrored = false,
		minimumStroke = minimumTextStroke,
	}: { mirrored?: boolean; minimumStroke?: number } = {},
): MultiPolygon {
	const { layout, strokes, bars } = paintedContours(shape);
	if (!strokes.length && !bars.length) return [];
	const scaleX = shape.width / layout.width;
	const scaleY = shape.height / layout.height;
	const rotation = uprightTextRotation(shape.rotation);
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	const center = textCenter(shape);
	const place = (ring: Pair[]): ClipperLib.Path =>
		ring.map(([x, y]) => {
			const u = (x - layout.width / 2) * scaleX * (mirrored ? -1 : 1);
			const v = (layout.height / 2 - y) * scaleY;
			return {
				X: Math.round((center.x + u * cos - v * sin) * scale),
				Y: Math.round((center.y + u * sin + v * cos) * scale),
			};
		});
	const clipper = new ClipperLib.Clipper();
	clipper.AddPaths(strokes.map(place), ClipperLib.PolyType.ptSubject, true);
	clipper.AddPaths(bars.map(place), ClipperLib.PolyType.ptClip, true);
	const union = new ClipperLib.PolyTree();
	clipper.Execute(
		ClipperLib.ClipType.ctUnion,
		union,
		ClipperLib.PolyFillType.pftNonZero,
		ClipperLib.PolyFillType.pftNonZero,
	);
	const stroke =
		(thinnestStroke[weightOf(shape.bold)] / font.unitsPerEm) *
		fontPixels *
		Math.min(Math.abs(scaleX), Math.abs(scaleY));
	const growth = (minimumStroke - stroke) / 2;
	if (growth <= 0) return fromTree(union);
	const offset = new ClipperLib.ClipperOffset(2, arcTolerance * scale);
	offset.AddPaths(
		ClipperLib.Clipper.PolyTreeToPaths(union),
		ClipperLib.JoinType.jtRound,
		ClipperLib.EndType.etClosedPolygon,
	);
	const grown = new ClipperLib.PolyTree();
	offset.Execute(grown, growth * scale);
	return fromTree(grown);
}
