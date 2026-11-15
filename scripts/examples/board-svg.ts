import type { RatsnestLine } from "@ecad/drawing-core/board/connectivity.ts";
import { isBoardFootprint } from "@ecad/drawing-core/board/footprints.ts";
import { hullPolygon, shapeHulls } from "@ecad/drawing-core/board/geometry.ts";
import {
	type EditorShape,
	symbolShapes,
	symbolTextShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { shapeLayers } from "@ecad/drawing-core/footprint/shapes.ts";
import type { ZoneFill } from "#/board/fill.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";

const order = ["B.Cu", "B.SilkS", "F.Cu", "F.SilkS", "Edge.Cuts"];

/** A quick top view of a board for reviewing generated layouts. */
export function boardSvg(
	shapes: readonly EditorShape[],
	fills: readonly ZoneFill[],
	ratsnest: readonly RatsnestLine[],
	scale = 20,
): string {
	const colors = darkSchematicTheme.appearance as Record<string, string>;
	const flat = shapes.flatMap((shape) =>
		isBoardFootprint(shape)
			? [
					...symbolShapes(shape),
					...symbolTextShapes(shape).map((text) => ({
						...text,
						layer: shape.layer,
					})),
				]
			: [shape],
	) as EditorShape[];
	const xs = flat.map((shape) => shape.x);
	const ys = flat.map((shape) => shape.y);
	const minX = Math.min(...xs) - 5;
	const maxX = Math.max(...xs) + 5;
	const minY = Math.min(...ys) - 5;
	const maxY = Math.max(...ys) + 5;
	const parts: string[] = [];
	const tx = (x: number) => ((x - minX) * scale).toFixed(2);
	const ty = (y: number) => ((maxY - y) * scale).toFixed(2);
	const polygon = (
		points: { x: number; y: number }[],
		fill: string,
		opacity = 1,
	) =>
		`<polygon points="${points.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ")}" fill="${fill}" fill-opacity="${opacity}"/>`;
	for (const layer of order) {
		for (const fill of fills)
			if (fill.layer === layer)
				for (const rings of fill.polygons)
					parts.push(
						`<path fill-rule="evenodd" fill="${colors[layer]}" fill-opacity="0.35" d="${rings
							.map(
								(ring) =>
									`M${ring.map(([x, y]) => `${tx(x)} ${ty(y)}`).join("L")}Z`,
							)
							.join("")}"/>`,
					);
		for (const shape of flat) {
			if (shape.kind === "rectangle" && shape.zone) continue;
			const layers = shapeLayers(shape);
			if (!layers.includes(layer as never)) continue;
			if (shape.kind === "text") {
				parts.push(
					`<text x="${tx(shape.x)}" y="${ty(shape.y)}" fill="${colors[layer]}" font-size="${shape.fontSize * scale}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${shape.text}</text>`,
				);
				continue;
			}
			const copper = layer.endsWith("Cu");
			const solid =
				copper && (shape.kind !== "rectangle" || shape.filled || shape.pad);
			for (const hull of shapeHulls(shape)) {
				const points = hullPolygon(hull);
				if (points.length < 3) continue;
				if (solid || shape.kind === "line")
					parts.push(polygon(points, colors[layer], copper ? 0.85 : 1));
				else
					parts.push(
						`<polygon points="${points.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ")}" fill="none" stroke="${colors[layer]}" stroke-width="1"/>`,
					);
			}
			const drill =
				"via" in shape && shape.via
					? shape.via.drill
					: "pad" in shape && shape.pad?.drill;
			if (drill && layer === "F.Cu")
				parts.push(
					`<circle cx="${tx(shape.x)}" cy="${ty(shape.y)}" r="${(drill / 2) * scale}" fill="#111"/>`,
				);
		}
	}
	for (const line of ratsnest)
		parts.push(
			`<line x1="${tx(line.from.x)}" y1="${ty(line.from.y)}" x2="${tx(line.to.x)}" y2="${ty(line.to.y)}" stroke="#fff" stroke-width="1.5"/>`,
		);
	const width = (maxX - minX) * scale;
	const height = (maxY - minY) * scale;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#0d0f13"/>${parts.join("")}</svg>`;
}
