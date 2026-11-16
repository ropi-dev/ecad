import { isZone } from "@ecad/drawing-core/board/connectivity.ts";
import { isBoardFootprint } from "@ecad/drawing-core/board/footprints.ts";
import {
	type Hull,
	hullPolygon,
	lineEnds,
	rectangleCorners,
	shapeHulls,
} from "@ecad/drawing-core/board/geometry.ts";
import { defaultBoardRules } from "@ecad/drawing-core/board/rules.ts";
import {
	type EditorShape,
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	type FootprintLayer,
	isCopperLayer,
} from "@ecad/drawing-core/footprint/layers.ts";
import {
	isPad,
	isVia,
	type PadShape,
	shapeDrill,
	shapeLayer,
	shapeLayers,
	type ViaShape,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { layerFill, type ZoneFill } from "#/board/fill.ts";

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

type ApertureFunction =
	| "SMDPad,CuDef"
	| "ComponentPad"
	| "ViaPad"
	| "Conductor";

const apertureMacros = {
	RotRect: ["21,1,$1,$2,0,0,$3"],
	RoundRect: [
		"4,1,4,$2,$3,$4,$5,$6,$7,$8,$9,$2,$3,0",
		"1,1,$1+$1,$2,$3",
		"1,1,$1+$1,$4,$5",
		"1,1,$1+$1,$6,$7",
		"1,1,$1+$1,$8,$9",
		"20,1,$1+$1,$2,$3,$4,$5,0",
		"20,1,$1+$1,$4,$5,$6,$7,0",
		"20,1,$1+$1,$6,$7,$8,$9,0",
		"20,1,$1+$1,$8,$9,$2,$3,0",
	],
};

type ApertureMacro = keyof typeof apertureMacros;

const angleTolerance = 1e-9;

class GerberWriter {
	private lines: string[] = [];
	private apertures = new Map<
		string,
		{ code: number; definition: string; function?: ApertureFunction }
	>();
	private macros = new Set<ApertureMacro>();
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

	private aperture(definition: string, apertureFunction?: ApertureFunction) {
		const key = `${apertureFunction ?? ""}|${definition}`;
		let aperture = this.apertures.get(key);
		if (aperture === undefined) {
			aperture = {
				code: 10 + this.apertures.size,
				definition,
				function: apertureFunction,
			};
			this.apertures.set(key, aperture);
		}
		if (aperture.code !== this.current) {
			this.body.push(`D${aperture.code}*`);
			this.current = aperture.code;
		}
	}

	private macro(name: ApertureMacro, parameters: readonly number[]) {
		this.macros.add(name);
		return `${name},${parameters.map(decimal).join("X")}`;
	}

	setPolarity(polarity: "D" | "C") {
		if (polarity === this.polarity) return;
		this.polarity = polarity;
		this.body.push(`%LP${polarity}*%`);
	}

	stroke(
		points: readonly Point[],
		width: number,
		apertureFunction?: ApertureFunction,
	) {
		if (points.length < 2) return;
		this.aperture(`C,${decimal(Math.max(width, 0.001))}`, apertureFunction);
		this.body.push(`${xy(points[0])}D02*`);
		for (const point of points.slice(1)) this.body.push(`${xy(point)}D01*`);
	}

	flash(
		definition: string,
		center: Point,
		apertureFunction?: ApertureFunction,
	) {
		this.aperture(definition, apertureFunction);
		this.body.push(`${xy(center)}D03*`);
	}

	flashCircle(
		center: Point,
		diameter: number,
		apertureFunction?: ApertureFunction,
	) {
		this.flash(`C,${decimal(diameter)}`, center, apertureFunction);
	}

	flashRectangle(
		corners: readonly Point[],
		radius: number,
		apertureFunction?: ApertureFunction,
	) {
		const [a, b, c, d] = corners;
		const center = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
		let width = Math.hypot(b.x - a.x, b.y - a.y);
		let height = Math.hypot(d.x - a.x, d.y - a.y);
		const direction = Math.atan2(b.y - a.y, b.x - a.x);
		const turns = Math.round(direction / (Math.PI / 2));
		let angle = direction - (turns * Math.PI) / 2;
		if (Math.abs(angle) < angleTolerance) angle = 0;
		if (turns % 2) [width, height] = [height, width];
		if (radius > 0) {
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			this.flash(
				this.macro("RoundRect", [
					radius,
					...[
						[-1, -1],
						[1, -1],
						[1, 1],
						[-1, 1],
					].flatMap(([sx, sy]) => {
						const x = (sx * width) / 2;
						const y = (sy * height) / 2;
						return [x * cos - y * sin, x * sin + y * cos];
					}),
				]),
				center,
				apertureFunction,
			);
		} else if (angle === 0)
			this.flash(
				`R,${decimal(width)}X${decimal(height)}`,
				center,
				apertureFunction,
			);
		else
			this.flash(
				this.macro("RotRect", [width, height, (angle * 180) / Math.PI]),
				center,
				apertureFunction,
			);
	}

	region(ring: readonly Point[]) {
		if (ring.length < 3) return;
		this.body.push("G36*", `${xy(ring[0])}D02*`, "G01*");
		for (const point of ring.slice(1)) this.body.push(`${xy(point)}D01*`);
		this.body.push(`${xy(ring[0])}D01*`, "G37*");
	}

	hull(hull: Hull) {
		if (hull.points.length === 1)
			this.flashCircle(hull.points[0], 2 * hull.radius);
		else if (hull.points.length === 2)
			this.stroke(hull.points, 2 * hull.radius);
		else this.region(hullPolygon(hull, 0, Math.PI / 16));
	}

	toString() {
		const macros = [...this.macros].map(
			(name) => `%AM${name}*\n${apertureMacros[name].join("*\n")}*%`,
		);
		const definitions: string[] = [];
		let attribute: ApertureFunction | undefined;
		for (const aperture of this.apertures.values()) {
			if (aperture.function !== attribute) {
				definitions.push(
					aperture.function
						? `%TA.AperFunction,${aperture.function}*%`
						: "%TD.AperFunction*%",
				);
				attribute = aperture.function;
			}
			definitions.push(`%ADD${aperture.code}${aperture.definition}*%`);
		}
		if (attribute) definitions.push("%TD.AperFunction*%");
		return [
			...this.lines,
			...macros,
			...definitions,
			"G01*",
			...this.body,
			"M02*",
			"",
		].join("\n");
	}
}

/** Board items with each footprint taken apart, in board coordinates. */
function flatItems(shapes: readonly EditorShape[]): EditorShape[] {
	return shapes.flatMap((shape) =>
		isBoardFootprint(shape) ? (symbolShapes(shape) as EditorShape[]) : [shape],
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

const padFunction = (shape: PadShape | ViaShape): ApertureFunction =>
	isVia(shape)
		? "ViaPad"
		: shape.pad.type === "through-hole"
			? "ComponentPad"
			: "SMDPad,CuDef";

function flashPad(
	writer: GerberWriter,
	shape: PadShape | ViaShape,
	margin: number,
	apertureFunction?: ApertureFunction,
) {
	if (shape.kind === "circle") {
		const diameter = shape.width + 2 * margin;
		if (diameter > 0)
			writer.flashCircle(
				{ x: shape.x, y: shape.y },
				diameter,
				apertureFunction,
			);
		return;
	}
	if (margin >= 0) {
		writer.flashRectangle(rectangleCorners(shape), margin, apertureFunction);
		return;
	}
	const width = shape.width + 2 * margin;
	const height = shape.height + 2 * margin;
	if (width > 0 && height > 0)
		writer.flashRectangle(
			rectangleCorners({ ...shape, width, height }),
			0,
			apertureFunction,
		);
}

const pasteLayer: Partial<Record<FootprintLayer, FootprintLayer>> = {
	"F.Cu": "F.Paste",
	"B.Cu": "B.Paste",
};
const maskLayer: Partial<Record<FootprintLayer, FootprintLayer>> = {
	"F.Cu": "F.Mask",
	"B.Cu": "B.Mask",
};

/** @return Each side's pad openings in the solder mask, as the mask Gerber draws them. */
export function maskOpenings(
	shapes: readonly EditorShape[],
	margin = defaultBoardRules.solderMaskMargin,
): {
	top: [number, number][][];
	bottom: [number, number][][];
} {
	const openings = {
		top: [] as [number, number][][],
		bottom: [] as [number, number][][],
	};
	for (const shape of flatItems(shapes)) {
		if (!isPad(shape)) continue;
		const layers = shapeLayers(shape);
		const sides = (["top", "bottom"] as const).filter((side) =>
			layers.some(
				(layer) => maskLayer[layer] === (side === "top" ? "F.Mask" : "B.Mask"),
			),
		);
		if (!sides.length) continue;
		const rings = shapeHulls(shape)
			.map((hull) => hullPolygon(hull, margin))
			.filter((ring) => ring.length >= 3)
			.map((ring) => ring.map(({ x, y }): [number, number] => [x, y]));
		for (const side of sides) openings[side].push(...rings);
	}
	return openings;
}

interface FabricationFile {
	name: string;
	content: string;
}

/**
 * Gerber X2 files for copper, mask, paste, silkscreen and the outline, and
 * an Excellon drill file for plated holes. Zone fills come first on their
 * copper layer, with their holes cut, so later copper draws over them.
 * Mask openings reach `maskMargin` past each pad. Text is not exported.
 */
export function exportFabrication(
	name: string,
	shapes: readonly EditorShape[],
	fills: readonly Pick<ZoneFill, "layer" | "polygons">[],
	maskMargin: number,
): FabricationFile[] {
	const items = flatItems(shapes);
	const tracks = new Set(
		shapes.filter(
			(shape) => shape.kind === "line" && isCopperLayer(shape.layer),
		),
	);
	const files: FabricationFile[] = [];
	for (const target of gerberLayers) {
		const writer = new GerberWriter(name, target.function, target.polarity);
		const copperLayer = isCopperLayer(target.layer) ? target.layer : undefined;
		if (copperLayer) {
			for (const polygon of layerFill(fills, copperLayer)) {
				writer.setPolarity("D");
				writer.region(polygon[0].map(([x, y]) => ({ x, y })));
				writer.setPolarity("C");
				for (const hole of polygon.slice(1))
					writer.region(hole.map(([x, y]) => ({ x, y })));
			}
			writer.setPolarity("D");
		}
		for (const shape of items) {
			if (shape.kind === "text") continue;
			if (isZone(shape)) continue;
			const layers = shapeLayers(shape);
			const copper = shapeLayer(shape);
			if (isPad(shape) || isVia(shape)) {
				const onCopper = layers.includes(target.layer);
				const pad = isPad(shape);
				const maskSide = layers.some(
					(layer) => maskLayer[layer] === target.layer,
				);
				const pasteSide =
					pad &&
					(shape as { pad: { paste?: boolean } }).pad.paste &&
					pasteLayer[copper] === target.layer;
				if (onCopper || pasteSide)
					flashPad(
						writer,
						shape,
						0,
						copperLayer ? padFunction(shape) : undefined,
					);
				else if (pad && maskSide) flashPad(writer, shape, maskMargin);
				continue;
			}
			if (shape.layer !== target.layer) continue;
			if (tracks.has(shape))
				writer.stroke(lineEnds(shape), shape.lineWidth, "Conductor");
			else drawGraphic(writer, shape);
		}
		files.push({ name: `${name}-${target.file}`, content: writer.toString() });
	}
	files.push({ name: `${name}-PTH.drl`, content: drillFile(items) });
	return files;
}

function drillFile(items: readonly EditorShape[]): string {
	const holes = new Map<string, Point[]>();
	for (const shape of items) {
		const drill = shapeDrill(shape);
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
