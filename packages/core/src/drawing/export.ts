import { Matrix4, Vector3 } from "three";
import { buildDrawingDisplay, type DisplayShape } from "#/drawing/display.ts";
import {
	darkSchematicTheme,
	lightSchematicTheme,
} from "#/drawing/schematic-theme.ts";
import type { EditorShape } from "#/drawing/shapes.ts";
import {
	fontPixels,
	lineHeight,
	type MeasureText,
	padding,
	textLayout,
} from "#/drawing/text.ts";
import { buildWorksheetDisplay, type SheetSize } from "#/drawing/worksheet.ts";
import { createShapeGeometry } from "#/engine/drawing/shapeGeometry.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export interface DrawingExportOptions {
	width: number;
	height: number;
	area: "drawing" | "sheet";
	background: "white" | "dark" | "transparent";
	sheet: SheetSize;
	measureText?: MeasureText;
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

export function exportDrawingSvg(
	shapes: EditorShape[],
	options: DrawingExportOptions,
): string {
	return measurePerformance(
		"drawing.export-svg",
		() => {
			const { width, height, background, sheet, area } = options;
			if (
				![width, height].every(
					(v) => Number.isInteger(v) && v > 0 && v <= 16384,
				) ||
				width * height > 100_000_000
			)
				throw new RangeError(
					"Export dimensions must be whole pixels up to 16384 per side and 100 megapixels.",
				);
			const measure =
				options.measureText ??
				((text: string) => text.length * fontPixels * 0.55);
			const display = buildDrawingDisplay(shapes, new Set(), [], measure);
			const dark = background === "dark";
			const theme = dark ? darkSchematicTheme : lightSchematicTheme;
			const colors = theme.appearance;
			const elements: { order: number; svg: string }[] = [];
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
				const local = new Matrix4().makeTranslation(shape.x, shape.y, 0);
				if (parentShape?.geometry.kind === "symbol" && shape.rotation !== 0) {
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
								shape.width * parentShape.width,
								shape.height * parentShape.height,
								1,
							),
						);
				} else
					local
						.multiply(new Matrix4().makeRotationZ(shape.rotation))
						.multiply(new Matrix4().makeScale(shape.width, shape.height, 1));
				const matrix = parent.clone().multiply(local);
				const color = colors[shape.appearance];
				let svg = "";
				if (shape.text !== undefined) {
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
					svg = `<g transform="matrix(${[m[0], -m[1], m[4], -m[5], m[12], -m[13]].map(number).join(" ")})" fill="${color}" font-family="Arial, sans-serif" font-size="${fontPixels}"${shape.bold ? ' font-weight="bold"' : ""} text-anchor="${align === "center" ? "middle" : align === "right" ? "end" : "start"}">${layout.lines.map((line, i) => `<text x="${x}" y="${baseline + i * lineHeight}"${line ? ` textLength="${measure(line, shape.bold)}" lengthAdjust="spacingAndGlyphs"` : ""} xml:space="preserve">${escapeXml(line)}</text>`).join("")}</g>`;
				} else {
					const geometry = createShapeGeometry(shape.geometry);
					try {
						const position = geometry.getAttribute("position"),
							index = geometry.getIndex();
						const count = position ? (index?.count ?? position.count) : 0;
						const paths: string[] = [];
						for (let i = 0; i < count; i += 3) {
							const points = [0, 1, 2].map((j) => {
								const p = new Vector3()
									.fromBufferAttribute(
										position,
										index ? index.getX(i + j) : i + j,
									)
									.applyMatrix4(matrix);
								include(p);
								return `${number(p.x)} ${number(-p.y)}`;
							});
							paths.push(`M${points[0]}L${points[1]}L${points[2]}Z`);
						}
						if (paths.length)
							svg = `<path fill="${color}" d="${paths.join("")}"/>`;
					} finally {
						geometry.dispose();
					}
				}
				elements.push({
					order: shape.renderOrder,
					svg: `<g data-name="${escapeXml(shape.name)}">${svg}</g>`,
				});
				for (const child of shape.children ?? []) visit(child, matrix, shape);
			};
			for (const shape of [
				...display.shapes,
				...display.connections,
				...display.junctions,
			])
				visit(shape);
			let worksheet = "";
			if (area === "sheet") {
				const page = buildWorksheetDisplay(sheet);
				minX = Math.min(minX, -sheet.width / 2);
				maxX = Math.max(maxX, sheet.width / 2);
				minY = Math.min(minY, -sheet.height / 2);
				maxY = Math.max(maxY, sheet.height / 2);
				worksheet = `<g fill="none" stroke="${theme.sheet}" stroke-width="0.15"><path d="${page.frame.map((p, i) => `${i % 2 ? "L" : "M"}${p.x} ${-p.y}`).join("")}"/></g><g fill="${theme.sheet}" font-family="Arial, sans-serif">${page.labels.map((label) => `<text x="${label.x}" y="${-label.y}" dominant-baseline="central" text-anchor="${label.align === "center" ? "middle" : "start"}" font-size="${label.fontSize}">${escapeXml(label.text)}</text>`).join("")}</g>`;
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
			const viewWidth = Math.max(1, maxX - minX),
				viewHeight = Math.max(1, maxY - minY);
			const rect =
				background === "transparent"
					? ""
					: `<rect x="${minX}" y="${-maxY}" width="${viewWidth}" height="${viewHeight}" fill="${dark ? theme.paper : "white"}"/>`;
			return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="background:${background === "transparent" ? "transparent" : dark ? theme.paper : "white"}" viewBox="${minX} ${-maxY} ${viewWidth} ${viewHeight}">${rect}${worksheet}${elements
				.sort((a, b) => a.order - b.order)
				.map((e) => e.svg)
				.join("")}</svg>`;
		},
		{ shapes: shapes.length },
	);
}
