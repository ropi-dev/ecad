import { isZone } from "@ecad/drawing-core/board/connectivity.ts";
import { isBoardFootprint } from "@ecad/drawing-core/board/footprints.ts";
import {
	type Hull,
	hullPolygon,
	lineEnds,
	rectangleCorners,
	shapeHulls,
} from "@ecad/drawing-core/board/geometry.ts";
import type {
	EditorShape,
	SymbolShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { symbolShapes } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";
import {
	isPad,
	isVia,
	shapeDrill,
	shapeLayer,
	shapeLayers,
} from "@ecad/drawing-core/footprint/shapes.ts";
import type { ZoneFill } from "#/board/fill.ts";

/** Solder mask grows this far past each pad. */
const maskExpansion = 0.05;

interface GerberLayer {
	layer: FootprintLayer;
	file: string;
	function: string;
	polarity?: "Positive" | "Negative";
}

const gerberLayers: readonly GerberLayer[] = [
	{ layer: "F.Cu", file: "F_Cu.gtl", function: "Copper,L1,Top" },
	{ layer: "B.Cu", file: "B_Cu.gbl", function: "Copper,L2,Bot" },
	{
		layer: "F.Mask",
		file: "F_Mask.gts",
		function: "Soldermask,Top",
		polarity: "Negative",
	},
	{
		layer: "B.Mask",
		file: "B_Mask.gbs",
		function: "Soldermask,Bot",
		polarity: "Negative",
	},
	{ layer: "F.Paste", file: "F_Paste.gtp", function: "Paste,Top" },
	{ layer: "B.Paste", file: "B_Paste.gbp", function: "Paste,Bot" },
	{ layer: "F.SilkS", file: "F_Silkscreen.gto", function: "Legend,Top" },
	{ layer: "B.SilkS", file: "B_Silkscreen.gbo", function: "Legend,Bot" },
	{ layer: "Edge.Cuts", file: "Edge_Cuts.gm1", function: "Profile,NP" },
];

const coordinate = (value: number) => Math.round(value * 1e6).toString();
const xy = (point: Point) => `X${coordinate(point.x)}Y${coordinate(point.y)}`;
const decimal = (value: number) => Number(value.toFixed(6)).toString();

class GerberWriter {
	private lines: string[] = [];
	private apertures = new Map<string, number>();
	private body: string[] = [];
	private polarity: "D" | "C" = "D";
	private current = -1;

	constructor(
		private name: string,
		fileFunction: string,
		polarity: "Positive" | "Negative" = "Positive",
	) {
		this.lines.push(
			`%TF.GenerationSoftware,ECAD,PCB,1*%`,
			`%TF.FileFunction,${fileFunction}*%`,
			`%TF.FilePolarity,${polarity}*%`,
			"%FSLAX46Y46*%",
			"%MOMM*%",
			`G04 ${this.name}*`,
			"%LPD*%",
		);
	}

	private aperture(definition: string) {
		let code = this.apertures.get(definition);
		if (code === undefined) {
			code = 10 + this.apertures.size;
			this.apertures.set(definition, code);
		}
		if (code !== this.current) {
			this.body.push(`D${code}*`);
			this.current = code;
		}
	}

	setPolarity(polarity: "D" | "C") {
		if (polarity === this.polarity) return;
		this.polarity = polarity;
		this.body.push(`%LP${polarity}*%`);
	}

	stroke(points: readonly Point[], width: number) {
		if (points.length < 2) return;
		this.aperture(`C,${decimal(Math.max(width, 0.001))}`);
		this.body.push(`${xy(points[0])}D02*`);
		for (const point of points.slice(1)) this.body.push(`${xy(point)}D01*`);
	}

	flashCircle(center: Point, diameter: number) {
		this.aperture(`C,${decimal(diameter)}`);
		this.body.push(`${xy(center)}D03*`);
	}

	region(ring: readonly Point[]) {
		if (ring.length < 3) return;
		this.body.push("G36*", `${xy(ring[0])}D02*`, "G01*");
		for (const point of ring.slice(1)) this.body.push(`${xy(point)}D01*`);
		this.body.push(`${xy(ring[0])}D01*`, "G37*");
	}

	hull(hull: Hull, margin = 0) {
		if (hull.points.length === 1)
			this.flashCircle(hull.points[0], 2 * (hull.radius + margin));
		else if (hull.points.length === 2 && margin === 0)
			this.stroke(hull.points, 2 * hull.radius);
		else this.region(hullPolygon(hull, margin, Math.PI / 16));
	}

	toString() {
		const definitions = [...this.apertures].map(
			([definition, code]) => `%ADD${code}${definition}*%`,
		);
		return [
			...this.lines,
			...definitions,
			"G01*",
			...this.body,
			"M02*",
			"",
		].join("\n");
	}
}

/** Board items with each footprint taken apart, in board coordinates. */
function flatItems(
	shapes: readonly EditorShape[],
): (EditorShape | SymbolShape)[] {
	return shapes.flatMap((shape) =>
		isBoardFootprint(shape) ? [...symbolShapes(shape)] : [shape],
	);
}

function drawGraphic(writer: GerberWriter, shape: EditorShape) {
	if (shape.kind === "line") {
		writer.stroke(lineEnds(shape), shape.lineWidth);
		return;
	}
	if (shape.kind === "rectangle" && !shape.filled && !isPad(shape)) {
		const corners = rectangleCorners(shape);
		writer.stroke([...corners, corners[0]], shape.lineWidth);
		return;
	}
	if (
		shape.kind === "circle" &&
		!shape.filled &&
		!isPad(shape) &&
		!isVia(shape)
	) {
		const steps = 64;
		const radius = shape.width / 2;
		writer.stroke(
			Array.from({ length: steps + 1 }, (_, index) => ({
				x: shape.x + radius * Math.cos((2 * Math.PI * index) / steps),
				y: shape.y + radius * Math.sin((2 * Math.PI * index) / steps),
			})),
			shape.lineWidth,
		);
		return;
	}
	for (const hull of shapeHulls(shape)) writer.hull(hull);
}

const pasteLayer: Partial<Record<FootprintLayer, FootprintLayer>> = {
	"F.Cu": "F.Paste",
	"B.Cu": "B.Paste",
};
const maskLayer: Partial<Record<FootprintLayer, FootprintLayer>> = {
	"F.Cu": "F.Mask",
	"B.Cu": "B.Mask",
};

export interface FabricationFile {
	name: string;
	content: string;
}

/**
 * Gerber X2 files for copper, mask, paste, silkscreen and the outline, and
 * an Excellon drill file for plated holes. Zone fills come first on their
 * copper layer, with their holes cut, so later copper draws over them.
 * Text is not exported.
 */
export function exportFabrication(
	name: string,
	shapes: readonly EditorShape[],
	fills: readonly ZoneFill[],
): FabricationFile[] {
	const items = flatItems(shapes);
	const files: FabricationFile[] = [];
	for (const target of gerberLayers) {
		const writer = new GerberWriter(name, target.function, target.polarity);
		if (target.layer === "F.Cu" || target.layer === "B.Cu") {
			for (const fill of fills) {
				if (fill.layer !== target.layer) continue;
				for (const polygon of fill.polygons) {
					writer.setPolarity("D");
					writer.region(polygon[0].map(([x, y]) => ({ x, y })));
					writer.setPolarity("C");
					for (const hole of polygon.slice(1))
						writer.region(hole.map(([x, y]) => ({ x, y })));
				}
			}
			writer.setPolarity("D");
		}
		for (const shape of items) {
			if (shape.kind === "text") continue;
			if (isZone(shape as EditorShape)) continue;
			const layers = shapeLayers(shape as EditorShape);
			const copper = shapeLayer(shape as EditorShape);
			if (isPad(shape as EditorShape) || isVia(shape as EditorShape)) {
				const onCopper = layers.includes(target.layer);
				const pad = isPad(shape as EditorShape);
				const maskSide = layers.some(
					(layer) => maskLayer[layer] === target.layer,
				);
				const pasteSide =
					pad &&
					(shape as { pad: { paste?: boolean } }).pad.paste &&
					pasteLayer[copper] === target.layer;
				if (onCopper || pasteSide)
					for (const hull of shapeHulls(shape as EditorShape))
						writer.hull(hull);
				else if (pad && maskSide)
					for (const hull of shapeHulls(shape as EditorShape))
						writer.hull(hull, maskExpansion);
				continue;
			}
			if (shape.layer !== target.layer) continue;
			drawGraphic(writer, shape as EditorShape);
		}
		files.push({ name: `${name}-${target.file}`, content: writer.toString() });
	}
	files.push({ name: `${name}-PTH.drl`, content: drillFile(items) });
	return files;
}

function drillFile(items: readonly (EditorShape | SymbolShape)[]): string {
	const holes = new Map<string, Point[]>();
	for (const shape of items) {
		const drill = shapeDrill(shape as EditorShape);
		if (drill === undefined) continue;
		const key = drill.toFixed(3);
		const list = holes.get(key) ?? [];
		list.push({ x: shape.x, y: shape.y });
		holes.set(key, list);
	}
	const tools = [...holes.keys()].sort((a, b) => Number(a) - Number(b));
	const lines = [
		"M48",
		"; DRILL file from ECAD",
		"; FORMAT={-:-/ absolute / metric / decimal}",
		"; #@! TF.FileFunction,Plated,1,2,PTH",
		"FMAT,2",
		"METRIC",
		...tools.map((tool, index) => `T${index + 1}C${tool}`),
		"%",
		"G90",
		"G05",
	];
	tools.forEach((tool, index) => {
		lines.push(`T${index + 1}`);
		for (const point of holes.get(tool) ?? [])
			lines.push(`X${point.x.toFixed(3)}Y${point.y.toFixed(3)}`);
	});
	lines.push("T0", "M30", "");
	return lines.join("\n");
}
