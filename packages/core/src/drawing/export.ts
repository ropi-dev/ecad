import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	type CopperLayer,
	type FootprintLayer,
	footprintLayers,
} from "@ecad/drawing-core/footprint/layers.ts";
import {
	boardDrawOrder,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { Matrix4, Vector3 } from "three";
import {
	type DrillHole,
	drillHoles,
	holeCutsLayer,
	holeMarked,
	holeOutline,
} from "#/board/drill.ts";
import {
	buildDrawingDisplay,
	type DisplayShape,
	rotatesFreeOfParentScale,
} from "#/drawing/display.ts";
import {
	darkSchematicTheme,
	printSchematicTheme,
} from "#/drawing/schematic-theme.ts";
import {
	drawingFontStack,
	fontPixels,
	lineHeight,
	type MeasureText,
	overbarRise,
	overbarThickness,
	padding,
	textLayout,
} from "#/drawing/text.ts";
import { buildWorksheetDisplay, type SheetSize } from "#/drawing/worksheet.ts";
import { createShapeGeometry } from "#/engine/drawing/shapeGeometry.ts";
import type { MultiPolygon } from "#/engine/types.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export interface DrawingZoneFill {
	shapeId: number;
	layer: CopperLayer;
	polygons: MultiPolygon;
}

export interface DrawingExportOptions {
	width: number;
	height: number;
	area: "drawing" | "sheet";
	background: "white" | "dark" | "transparent";
	sheet: SheetSize;
	measureText?: MeasureText;
	coverOutput?: boolean;
	zoneFills?: readonly DrawingZoneFill[];
	maskMargin?: number;
}

export type DrawingSceneOptions = Pick<
	DrawingExportOptions,
	"area" | "background" | "sheet" | "measureText" | "zoneFills" | "maskMargin"
> & {
	layer?: FootprintLayer;
	maskOpenings?: readonly (readonly [number, number])[][];
	drillHoles?: readonly DrillHole[];
};

const layerAppearances = new Set<string>([
	...footprintLayers.filter((layer) => layer !== "Edge.Cuts"),
	"pad-through",
	"via",
]);

export interface SceneTextLine {
	text: string;
	baseline: number;
	width: number;
	overbars: readonly (readonly [number, number])[];
}

export type SceneItem = { order: number; name: string; color: string } & (
	| { kind: "triangles"; points: number[] }
	| { kind: "rings"; rings: number[][] }
	| {
			kind: "text";
			matrix: readonly [number, number, number, number, number, number];
			bold: boolean;
			align: "left" | "center" | "right";
			x: number;
			lines: SceneTextLine[];
	  }
	| { kind: "empty" }
);

export interface DrawingScene {
	view: { x: number; y: number; width: number; height: number };
	paper: string | null;
	sheetColor: string;
	layerColor?: string;
	worksheet?: ReturnType<typeof buildWorksheetDisplay>;
	items: SceneItem[];
}

export const overbarTop = (baseline: number) =>
	baseline - overbarRise - overbarThickness / 2;

export const lineStart = (
	x: number,
	width: number,
	align: "left" | "center" | "right",
) => (align === "center" ? x - width / 2 : align === "right" ? x - width : x);

function overbarPath(
	line: SceneTextLine,
	x: number,
	align: "left" | "center" | "right",
) {
	if (!line.overbars.length) return "";
	const left = lineStart(x, line.width, align);
	const top = overbarTop(line.baseline);
	return `<path d="${line.overbars
		.map(
			([from, to]) =>
				`M${left + from} ${top}h${to - from}v${overbarThickness}h${from - to}Z`,
		)
		.join("")}"/>`;
}
const escapeXml = (value: string) =>
	value.replace(
		/[<>&"']/g,
		(c) =>
			({
				"<": "&lt;",
				">": "&gt;",
				"&": "&amp;",
				'"': "&quot;",
				"'": "&apos;",
			})[c] ?? c,
	);
const number = (value: number) => Number(value.toFixed(6));

export function buildDrawingScene(
	shapes: EditorShape[],
	options: DrawingSceneOptions,
): DrawingScene {
	const { background, sheet, area } = options;
	const measure =
		options.measureText ?? ((text: string) => text.length * fontPixels * 0.6);
	const zones = new Set(
		shapes.flatMap((shape) =>
			shape.kind === "rectangle" && shape.zone ? [shape.id] : [],
		),
	);
	const fills = (options.zoneFills ?? []).filter((fill) =>
		zones.has(fill.shapeId),
	);
	const filled = new Set(fills.map((fill) => fill.shapeId));
	const drawn = filled.size
		? shapes.filter((shape) => !filled.has(shape.id))
		: shapes;
	const display = buildDrawingDisplay(drawn, new Set(), [], measure);
	const dark = background === "dark";
	const theme = dark ? darkSchematicTheme : printSchematicTheme;
	const colors = theme.appearance;
	const items: SceneItem[] = [];
	const padNumbers: SceneItem[] = [];
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	const include = (point: Vector3) => {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	};
	const visit = (
		shape: DisplayShape,
		parent = new Matrix4(),
		parentShape?: DisplayShape,
	) => {
		if (shape.appearance === "pad-hole") return;
		const local = new Matrix4().makeTranslation(shape.x, shape.y, 0);
		if (rotatesFreeOfParentScale(shape, parentShape)) {
			local
				.multiply(
					new Matrix4().makeScale(
						1 / parentShape.width,
						1 / parentShape.height,
						1,
					),
				)
				.multiply(new Matrix4().makeRotationZ(shape.rotation))
				.multiply(
					new Matrix4().makeScale(
						shape.width * parentShape.width * (shape.mirrored ? -1 : 1),
						shape.height * parentShape.height,
						1,
					),
				);
		} else
			local
				.multiply(new Matrix4().makeRotationZ(shape.rotation))
				.multiply(
					new Matrix4().makeScale(
						shape.mirrored ? -shape.width : shape.width,
						shape.height,
						1,
					),
				);
		const matrix = parent.clone().multiply(local);
		const color =
			options.layer && layerAppearances.has(shape.appearance)
				? colors[options.layer]
				: colors[shape.appearance];
		const base = { order: shape.renderOrder, name: shape.name, color };
		let item: SceneItem = { ...base, kind: "empty" };
		if (shape.text !== undefined) {
			const bold = shape.bold ?? false;
			const layout = textLayout(shape.text, measure, shape.bold);
			for (const x of [-0.5, 0.5])
				for (const y of [-0.5, 0.5])
					include(new Vector3(x, y, 0).applyMatrix4(matrix));
			const m = matrix
				.clone()
				.multiply(new Matrix4().makeTranslation(-0.5, 0.5, 0))
				.multiply(
					new Matrix4().makeScale(1 / layout.width, -1 / layout.height, 1),
				).elements;
			const align = shape.horizontalAlign ?? "left";
			const x =
				align === "center"
					? layout.width / 2
					: align === "right"
						? layout.width - padding
						: padding;
			const baseline =
				(layout.height -
					(layout.lines.length - 1) * lineHeight +
					fontPixels * 0.72) /
				2;
			item = {
				...base,
				kind: "text",
				matrix: [m[0], m[1], m[4], m[5], m[12], m[13]],
				bold,
				align,
				x,
				lines: layout.lines.map((line, i) => ({
					text: line,
					baseline: baseline + i * lineHeight,
					width: measure(line, shape.bold),
					overbars: layout.overbars[i].map(([start, end]) => [
						measure(line.slice(0, start), shape.bold),
						measure(line.slice(0, end), shape.bold),
					]),
				})),
			};
		} else {
			const geometry = createShapeGeometry(shape.geometry);
			try {
				const position = geometry.getAttribute("position"),
					index = geometry.getIndex();
				const count = position ? (index?.count ?? position.count) : 0;
				const points: number[] = [];
				const p = new Vector3();
				for (let i = 0; i < count; i++) {
					p.fromBufferAttribute(position, index ? index.getX(i) : i);
					p.applyMatrix4(matrix);
					include(p);
					points.push(p.x, p.y);
				}
				if (points.length) item = { ...base, kind: "triangles", points };
			} finally {
				geometry.dispose();
			}
		}
		items.push(item);
		if (shape.appearance === "pad-number") padNumbers.push(item);
		for (const child of shape.children ?? []) visit(child, matrix, shape);
	};
	for (const shape of [
		...display.shapes,
		...display.connections,
		...display.junctions,
	])
		visit(shape);
	for (const fill of fills) {
		const rank = boardDrawOrder.indexOf(fill.layer);
		const above = drawn.findIndex((shape) =>
			shapeLayers(shape).some((layer) => boardDrawOrder.indexOf(layer) >= rank),
		);
		const first = above < 0 ? drawn.length : above;
		const rings = fill.polygons.flat().map((ring) =>
			ring.flatMap(([x, y]) => {
				include(new Vector3(x, y, 0));
				return [x, y];
			}),
		);
		items.push({
			order: first + 0.5,
			name: `zone fill ${fill.shapeId}`,
			color: colors[options.layer ?? fill.layer],
			...(rings.length
				? { kind: "rings" as const, rings }
				: { kind: "empty" as const }),
		});
	}
	for (const [index, ring] of (options.maskOpenings ?? []).entries())
		items.push({
			order: -1,
			name: `mask opening ${index}`,
			color: colors[options.layer ?? "F.Mask"],
			kind: "rings",
			rings: [
				ring.flatMap(([x, y]) => {
					include(new Vector3(x, y, 0));
					return [x, y];
				}),
			],
		});
	const top = items.reduce((most, item) => Math.max(most, item.order), 0) + 1;
	for (const [index, hole] of (
		options.drillHoles ?? drillHoles(shapes)
	).entries()) {
		if (!holeMarked(hole, options.layer)) continue;
		const ring = holeOutline(hole);
		if (ring.length < 6) continue;
		for (let i = 0; i + 1 < ring.length; i += 2)
			include(new Vector3(ring[i], ring[i + 1], 0));
		items.push({
			order: top,
			name: `drill mark ${index}`,
			color: holeCutsLayer(hole, options.layer)
				? colors["pad-hole"]
				: dark
					? "#ffffff"
					: "#000000",
			kind: "rings",
			rings: [ring],
		});
	}
	for (const label of padNumbers) label.order += top + 1;
	let worksheet: DrawingScene["worksheet"];
	if (area === "sheet") {
		worksheet = buildWorksheetDisplay(sheet);
		minX = Math.min(minX, -sheet.width / 2);
		maxX = Math.max(maxX, sheet.width / 2);
		minY = Math.min(minY, -sheet.height / 2);
		maxY = Math.max(maxY, sheet.height / 2);
	}
	if (!Number.isFinite(minX)) {
		minX = -5;
		minY = -5;
		maxX = 5;
		maxY = 5;
	}
	const margin = area === "drawing" ? 3 : 0;
	minX -= margin;
	minY -= margin;
	maxX += margin;
	maxY += margin;
	return {
		view: {
			x: minX,
			y: -maxY,
			width: Math.max(1, maxX - minX),
			height: Math.max(1, maxY - minY),
		},
		paper: background === "transparent" ? null : dark ? theme.paper : "white",
		sheetColor: theme.sheet,
		...(options.layer ? { layerColor: colors[options.layer] } : {}),
		worksheet,
		items: items.sort((a, b) => a.order - b.order),
	};
}

export function exportDrawingSvg(
	shapes: EditorShape[],
	options: DrawingExportOptions,
): string {
	return measurePerformance(
		"drawing.export-svg",
		() => {
			const { width, height } = options;
			if (
				![width, height].every(
					(v) => Number.isInteger(v) && v > 0 && v <= 16384,
				) ||
				width * height > 100_000_000
			)
				throw new RangeError(
					"Export dimensions must be whole pixels up to 16384 per side and 100 megapixels.",
				);
			const scene = buildDrawingScene(shapes, options);
			let {
				x: viewX,
				y: viewY,
				width: viewWidth,
				height: viewHeight,
			} = scene.view;
			if (options.coverOutput) {
				const unitsPerPixel = Math.max(viewWidth / width, viewHeight / height);
				const padX = (width * unitsPerPixel - viewWidth) / 2;
				const padY = (height * unitsPerPixel - viewHeight) / 2;
				viewX -= padX;
				viewY -= padY;
				viewWidth += 2 * padX;
				viewHeight += 2 * padY;
			}
			const page = scene.worksheet;
			const worksheet = page
				? `<g fill="none" stroke="${scene.sheetColor}" stroke-width="0.15"><path d="${page.frame.map((p, i) => `${i % 2 ? "L" : "M"}${p.x} ${-p.y}`).join("")}"/></g><g fill="${scene.sheetColor}" font-family="${drawingFontStack}">${page.labels.map((label) => `<text x="${label.x}" y="${-label.y}" dominant-baseline="central" text-anchor="${label.align === "center" ? "middle" : "start"}" font-size="${label.fontSize}">${escapeXml(label.text)}</text>`).join("")}</g>`
				: "";
			const rect = scene.paper
				? `<rect x="${viewX}" y="${viewY}" width="${viewWidth}" height="${viewHeight}" fill="${scene.paper}"/>`
				: "";
			return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="background:${scene.paper ?? "transparent"}" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}">${rect}${worksheet}${scene.items
				.map(
					(item) =>
						`<g data-name="${escapeXml(item.name)}">${svgItem(item)}</g>`,
				)
				.join("")}</svg>`;
		},
		{ shapes: shapes.length },
	);
}

function svgItem(item: SceneItem) {
	if (item.kind === "empty") return "";
	if (item.kind === "triangles") {
		const { points } = item;
		const paths: string[] = [];
		const at = (i: number) => `${number(points[i])} ${number(-points[i + 1])}`;
		for (let i = 0; i + 5 < points.length; i += 6)
			paths.push(`M${at(i)}L${at(i + 2)}L${at(i + 4)}Z`);
		return `<path fill="${item.color}" d="${paths.join("")}"/>`;
	}
	if (item.kind === "rings")
		return `<path fill="${item.color}" fill-rule="evenodd" d="${item.rings
			.map(
				(ring) =>
					`M${ring.map((value, i) => number(i % 2 ? -value : value)).join(" ")}Z`,
			)
			.join("")}"/>`;
	const m = item.matrix;
	const { align, x } = item;
	return `<g transform="matrix(${[m[0], -m[1], m[2], -m[3], m[4], -m[5]].map(number).join(" ")})" fill="${item.color}" font-family="${drawingFontStack}" font-size="${fontPixels}"${item.bold ? ' font-weight="bold"' : ""} text-anchor="${align === "center" ? "middle" : align === "right" ? "end" : "start"}">${item.lines.map((line) => `<text x="${x}" y="${line.baseline}"${line.text ? ` textLength="${line.width}" lengthAdjust="spacingAndGlyphs"` : ""} xml:space="preserve">${escapeXml(line.text)}</text>${overbarPath(line, x, align)}`).join("")}</g>`;
}
