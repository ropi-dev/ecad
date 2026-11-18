import { isZone } from "@ecad/drawing-core/board/connectivity.ts";
import { isBoardFootprint } from "@ecad/drawing-core/board/footprints.ts";
import {
	type Hull,
	hullPolygon,
	lineEnds,
	rectangleCorners,
	shapeHulls,
} from "@ecad/drawing-core/board/geometry.ts";
import {
	type EditorShape,
	symbolShapes,
	symbolTextShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	boardCopperLayers,
	copperLayerFunction,
	type FootprintLayer,
	isCopperLayer,
} from "@ecad/drawing-core/footprint/layers.ts";
import {
	isHole,
	isPad,
	isVia,
	type PadShape,
	shapeLayer,
	shapeLayers,
	type ViaShape,
} from "@ecad/drawing-core/footprint/shapes.ts";
import { type DrillHole, drillHoles } from "#/board/drill.ts";
import { layerFill, type ZoneFill } from "#/board/fill.ts";
import { maskLayer } from "#/board/mask.ts";
import { textPolygons } from "#/board/text-outline.ts";
import type { MultiPolygon } from "#/engine/geometry.ts";

interface GerberLayer {
	layer: FootprintLayer;
	file: string;
	function: string;
	polarity?: "Positive" | "Negative";
}

/** @return The Gerber file of each copper layer, front first, named and numbered as KiCad does. */
export const copperGerberLayers = (count: number): GerberLayer[] =>
	boardCopperLayers(count).map((layer, index) => ({
		layer,
		file:
			layer === "F.Cu"
				? "F_Cu.gtl"
				: layer === "B.Cu"
					? "B_Cu.gbl"
					: `${layer.replace(".", "_")}.g${index}`,
		function: copperLayerFunction(layer, count),
	}));

const otherGerberLayers: readonly GerberLayer[] = [
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
	Oval: ["1,1,$1,$2,$3", "1,1,$1,$4,$5", "20,1,$1,$2,$3,$4,$5,0"],
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

	flashStadium(
		ends: readonly [Point, Point],
		diameter: number,
		apertureFunction?: ApertureFunction,
	) {
		const [a, b] = ends;
		const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		const direction = Math.atan2(b.y - a.y, b.x - a.x);
		const turns = Math.round(direction / (Math.PI / 2));
		if (Math.abs(direction - (turns * Math.PI) / 2) < angleTolerance) {
			const [width, height] =
				turns % 2
					? [diameter, length + diameter]
					: [length + diameter, diameter];
			this.flash(
				`O,${decimal(width)}X${decimal(height)}`,
				center,
				apertureFunction,
			);
		} else
			this.flash(
				this.macro("Oval", [
					diameter,
					a.x - center.x,
					a.y - center.y,
					b.x - center.x,
					b.y - center.y,
				]),
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

	polygon(rings: MultiPolygon[number]) {
		const points = fracture(rings).map(([x, y]) => ({ x, y }));
		this.region(
			points.filter(
				(point, index) => xy(point) !== xy(points.at(index - 1) ?? point),
			),
		);
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

type Ring = MultiPolygon[number][number];

const signedArea = (ring: Ring) =>
	ring.reduce((area, [x, y], index) => {
		const [nextX, nextY] = ring[(index + 1) % ring.length];
		return area + x * nextY - nextX * y;
	}, 0);

function fracture([outer, ...holes]: MultiPolygon[number]): Ring {
	let ring = [...outer];
	const sense = Math.sign(signedArea(outer));
	const leftmost = (hole: Ring) =>
		hole.reduce((best, [x], index) => (x < hole[best][0] ? index : best), 0);
	const ordered = holes
		.map((hole) =>
			Math.sign(signedArea(hole)) === sense ? [...hole].reverse() : hole,
		)
		.map((hole) => ({ hole, start: leftmost(hole) }))
		.sort((a, b) => a.hole[a.start][0] - b.hole[b.start][0]);
	for (const { hole, start } of ordered) {
		const [px, py] = hole[start];
		let edge = -1;
		let reach = -Infinity;
		for (let index = 0; index < ring.length; index++) {
			const [ax, ay] = ring[index];
			const [bx, by] = ring[(index + 1) % ring.length];
			if (ay > py === by > py) continue;
			const x = ax + ((py - ay) * (bx - ax)) / (by - ay);
			if (x <= px && x > reach) {
				reach = x;
				edge = index;
			}
		}
		if (edge < 0) continue;
		const bridge: [number, number] = [reach, py];
		ring = [
			...ring.slice(0, edge + 1),
			bridge,
			...hole.slice(start),
			...hole.slice(0, start + 1),
			bridge,
			...ring.slice(edge + 1),
		];
	}
	return ring;
}

/** Board items with each footprint taken apart, in board coordinates. */
function flatItems(shapes: readonly EditorShape[]): EditorShape[] {
	return shapes.flatMap((shape): EditorShape[] =>
		isBoardFootprint(shape)
			? [
					...(symbolShapes(shape) as EditorShape[]),
					...symbolTextShapes(shape).map((text) => ({
						...text,
						layer: shape.layer ?? "F.SilkS",
					})),
				]
			: [shape],
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
	const [{ points, radius }] = shapeHulls(shape);
	const grown = radius + margin;
	if (points.length < 3) {
		if (grown <= 0) return;
		if (points.length === 1)
			writer.flashCircle(points[0], 2 * grown, apertureFunction);
		else
			writer.flashStadium([points[0], points[1]], 2 * grown, apertureFunction);
		return;
	}
	if (grown >= 0) {
		writer.flashRectangle(points, grown, apertureFunction);
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
interface FabricationFile {
	name: string;
	content: string;
}

/**
 * Gerber X2 files for each of the board's `copperLayers` copper layers, mask,
 * paste, silkscreen and the outline, an
 * Excellon drill file for plated holes, and one for unplated holes when the
 * board has any. Zone fills come first on their copper layer, with their
 * holes cut, so later copper draws over them. Mask openings reach
 * `maskMargin` past each pad and unplated hole.
 */
export function exportFabrication(
	name: string,
	shapes: readonly EditorShape[],
	fills: readonly Pick<ZoneFill, "layer" | "polygons">[],
	maskMargin: number,
	copperLayers = 2,
): FabricationFile[] {
	const items = flatItems(shapes);
	const tracks = new Set(
		shapes.filter(
			(shape) => shape.kind === "line" && isCopperLayer(shape.layer),
		),
	);
	const files: FabricationFile[] = [];
	for (const target of [
		...copperGerberLayers(copperLayers),
		...otherGerberLayers,
	]) {
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
			if (shape.kind === "text") {
				if (shapeLayer(shape) !== target.layer) continue;
				if (isCopperLayer(target.layer) || target.layer === "Edge.Cuts")
					continue;
				const mirrored = target.layer.startsWith("B.");
				for (const polygon of textPolygons(shape, { mirrored }))
					writer.polygon(polygon);
				continue;
			}
			if (isZone(shape)) continue;
			const layers = shapeLayers(shape);
			if (isHole(shape)) {
				if (layers.includes(target.layer) && shape.width + 2 * maskMargin > 0)
					writer.flashCircle(
						{ x: shape.x, y: shape.y },
						shape.width + 2 * maskMargin,
					);
				continue;
			}
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
	const holes = drillHoles(shapes);
	files.push({
		name: `${name}-PTH.drl`,
		content: drillFile(
			holes.filter((hole) => hole.plated),
			`Plated,1,${copperLayers},PTH`,
		),
	});
	const unplated = holes.filter((hole) => !hole.plated);
	if (unplated.length)
		files.push({
			name: `${name}-NPTH.drl`,
			content: drillFile(unplated, `NonPlated,1,${copperLayers},NPTH`),
		});
	return files;
}

const drillMillimetres = (value: number) => {
	const text = value.toFixed(3);
	return text === "-0.000" ? "0.000" : text;
};
const drillXY = (point: Point) =>
	`X${drillMillimetres(point.x)}Y${drillMillimetres(point.y)}`;

function drillFile(
	drilled: readonly DrillHole[],
	fileFunction: string,
): string {
	const holes = new Map<string, string[]>();
	for (const hole of drilled) {
		const key = hole.diameter.toFixed(3);
		const list = holes.get(key) ?? [];
		const [from, to] = hole.ends.map(drillXY);
		if (from === to) list.push(from);
		else list.push(`${from}G85${to}`, "G05");
		holes.set(key, list);
	}
	const tools = [...holes.keys()].sort((a, b) => Number(a) - Number(b));
	const lines = [
		"M48",
		"; DRILL file from ECAD",
		"; FORMAT={-:-/ absolute / metric / decimal}",
		`; #@! TF.FileFunction,${fileFunction}`,
		"FMAT,2",
		"METRIC",
		...tools.map((tool, index) => `T${index + 1}C${tool}`),
		"%",
		"G90",
		"G05",
	];
	tools.forEach((tool, index) => {
		lines.push(`T${index + 1}`);
		lines.push(...(holes.get(tool) ?? []));
	});
	lines.push("T0", "M30", "");
	return lines.join("\n");
}
