import { unionFind } from "@ecad/drawing-core/lib/union-find.ts";
import type { ShapeInput } from "#/commands/drawing-commands.ts";
import { electricalNets } from "#/drawing/named-nets.ts";
import { drawingShapeSchema } from "#/drawing/schema.ts";
import {
	connectionTolerance,
	DEFAULT_LINE_WIDTH,
	type EditorShape,
	type EditorSymbol,
	PIN_RADIUS,
	pinTerminals,
	type SymbolShape,
	shapeBounds,
	type TextShape,
} from "#/drawing/shapes.ts";
import type { Bounds } from "#/drawing/types.ts";
import { asSentence as sentence } from "#/formats/diagnostics.ts";
import { errorMessage } from "#/lib/error-message.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import {
	node,
	nodes,
	numbers,
	parseSExpr,
	type SExpr,
	value,
} from "./sexpr.ts";

type XY = [number, number];
export interface KiCadImportReport {
	version: string;
	sheet: { width: number; height: number };
	metadata: SExpr[];
	components: {
		uuid: string;
		libraryId: string;
		unit: number;
		rotation: number;
		mirror: string;
		properties: Record<string, string>;
	}[];
	labels: { kind: string; text: string; x: number; y: number }[];
	supplies: { reference: string; text: string; x: number; y: number }[];
	/** Each skipped item also appears in `warnings` as a sentence. */
	warnings: string[];
	/** Items left out of the drawing. Everything else was imported. */
	skipped: { item: string; reason: string }[];
	counts: Record<string, number>;
}
export interface KiCadImportResult {
	shapes: EditorShape[];
	report: KiCadImportReport;
}
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const hidden = (n: SExpr) =>
	n.includes("hide") ||
	node(n, "effects").includes("hide") ||
	value(n, "hide") === "yes";
const geometry = (
	x: number,
	y: number,
	width: number,
	height: number,
	rotation = 0,
	lineWidth = DEFAULT_LINE_WIDTH,
) => ({
	id: 1,
	x,
	y,
	width: Math.max(width, 0.001),
	height: Math.max(height, 0.001),
	rotation,
	lineWidth,
});
const line = (
	a: XY,
	b: XY,
	kind: "line" | "wire" = "line",
	stroke = DEFAULT_LINE_WIDTH,
): SymbolShape => ({
	...geometry(
		(a[0] + b[0]) / 2,
		(a[1] + b[1]) / 2,
		Math.hypot(b[0] - a[0], b[1] - a[1]),
		stroke,
		Math.atan2(b[1] - a[1], b[0] - a[0]),
		stroke,
	),
	kind,
});
const words = (key: string) =>
	key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
/** The KiCad source position, or else the UUID, so the item can be found. */
const locate = (item: SExpr, at: SExpr = node(item, "at")) => {
	const [x, y] = at.slice(1);
	const uuid = value(item, "uuid");
	return typeof x === "string" && typeof y === "string"
		? ` at (${x}, ${y})`
		: uuid
			? ` with UUID ${uuid}`
			: "";
};
/**
 * Names one invalid field in words instead of listing schema issues. The
 * deepest issue is the cause: a bad child also invalidates the symbol size.
 */
function describeInvalidShape(
	shape: ShapeInput,
	issues: readonly { path: readonly PropertyKey[]; message: string }[],
) {
	const issue = issues.reduce<(typeof issues)[number] | undefined>(
		(deepest, next) =>
			!deepest || next.path.length > deepest.path.length ? next : deepest,
		undefined,
	);
	if (!issue) return "The converted shape is invalid.";
	const { path } = issue;
	if (!path.length) return sentence(issue.message);
	const [first, index] = path;
	let owner = "";
	let key = String(path.at(-1));
	if (first === "children" && typeof index === "number" && path.length > 2) {
		const child = shape.kind === "symbol" ? shape.children[index] : undefined;
		owner = ` of child ${index + 1}${child ? ` (a ${words(child.kind)})` : ""}`;
		// A KiCad circle has a radius; its converted width and height derive from it.
		if (child?.kind === "circle" && (key === "width" || key === "height"))
			key = "radius";
	} else if (first === "texts" && typeof index === "number" && path.length > 2)
		owner = " of an attribute label";
	const field = `${words(key)}${owner}`;
	return /received NaN$/.test(issue.message)
		? `The ${field} is not a number.`
		: `The ${field} is invalid (${issue.message.replace(/^Invalid input: /, "")}).`;
}
type Segment = [XY, XY];

function distance(point: XY, [a, b]: Segment) {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const length = dx * dx + dy * dy;
	const t = length
		? Math.max(
				0,
				Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length),
			)
		: 0;
	return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}
const near = (a: XY, b: XY) => distance(a, [b, b]) <= connectionTolerance;

function wireSegments(shape: EditorShape): Segment[] {
	if (shape.kind !== "wire") return [];
	const dx = (Math.cos(shape.rotation) * shape.width) / 2;
	const dy = (Math.sin(shape.rotation) * shape.width) / 2;
	return [
		[
			[shape.x - dx, shape.y - dy],
			[shape.x + dx, shape.y + dy],
		],
	];
}

const isVertical = ([a, b]: Segment) =>
	Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1]);
/**
 * The coordinate across a wire, such as y for a horizontal wire, at its
 * center. Normalization rebuilds merged and cut wires on this line.
 */
const across = ([a, b]: Segment) => {
	const axis = isVertical([a, b]) ? 0 : 1;
	return (a[axis] + b[axis]) / 2;
};
/** Floating-point noise; anything larger is a real offset. */
const EXACT = 1e-12;
/** A wire that normalization can rebuild without moving it. */
const exactlyStraight = ([a, b]: Segment) => {
	const axis = isVertical([a, b]) ? 0 : 1;
	return Math.abs(a[axis] - b[axis]) <= EXACT;
};

/** The extent of a wire along its own direction. */
const extent = (segment: Segment): [number, number] => {
	const along = isVertical(segment) ? 1 : 0;
	return [
		Math.min(segment[0][along], segment[1][along]),
		Math.max(segment[0][along], segment[1][along]),
	];
};

/**
 * Wires whose merge adds no geometry: exactly in line, overlapping or touching.
 * Normalization would fill any gap between them, which can reach a label or
 * pin that neither wire touched.
 */
function mergeKeepsShape(first: Segment, second: Segment) {
	const [a, b] = extent(first);
	const [c, d] = extent(second);
	return (
		exactlyStraight(first) &&
		exactlyStraight(second) &&
		Math.abs(across(first) - across(second)) <= EXACT &&
		a <= d + EXACT &&
		c <= b + EXACT
	);
}

/** Wires that wire normalization may merge: parallel, in line and overlapping. */
function mayMerge(first: Segment, second: Segment) {
	if (isVertical(first) !== isVertical(second)) return false;
	const along = isVertical(first) ? 1 : 0;
	const [a, b] = first;
	const [c, d] = second;
	return (
		Math.abs(across(first) - across(second)) <= connectionTolerance &&
		Math.min(a[along], b[along]) <=
			Math.max(c[along], d[along]) + connectionTolerance &&
		Math.min(c[along], d[along]) <=
			Math.max(a[along], b[along]) + connectionTolerance
	);
}

const overlaps = (first: Bounds, second: Bounds) =>
	first.minX <= second.maxX &&
	first.maxX >= second.minX &&
	first.minY <= second.maxY &&
	first.maxY >= second.minY;
const segmentBounds = (segments: readonly Segment[], margin = 0): Bounds => {
	const points = segments.flat();
	return {
		minX: Math.min(...points.map((point) => point[0])) - margin,
		minY: Math.min(...points.map((point) => point[1])) - margin,
		maxX: Math.max(...points.map((point) => point[0])) + margin,
		maxY: Math.max(...points.map((point) => point[1])) + margin,
	};
};

/**
 * Normalization merges a cluster of parallel wires into one wire on the line of
 * one of them, chosen by the command that runs it, and rebuilds a wire it cuts
 * on that wire's center line. A cluster whose wires are slightly tilted or not
 * exactly in line can move, even a cluster of one, and one with gaps along its
 * length gets them filled. These are the areas such clusters can change.
 */
function driftAreas(wires: readonly Segment[]): Bounds[] {
	const sets = unionFind(wires.length);
	for (let first = 0; first < wires.length; first++)
		for (let second = first + 1; second < wires.length; second++)
			if (mayMerge(wires[first], wires[second])) sets.union(first, second);
	const clusters = new Map<number, Segment[]>();
	for (const [index, wire] of wires.entries())
		clusters.set(sets.find(index), [
			...(clusters.get(sets.find(index)) ?? []),
			wire,
		]);
	return [...clusters.values()]
		.filter((cluster) => {
			const lines = cluster.map(across);
			if (
				!cluster.every(exactlyStraight) ||
				Math.max(...lines) - Math.min(...lines) > EXACT
			)
				return true;
			const extents = cluster.map(extent).sort((a, b) => a[0] - b[0]);
			let reach = extents[0][1];
			for (const [start, end] of extents) {
				if (start > reach + EXACT) return true;
				reach = Math.max(reach, end);
			}
			return false;
		})
		.map((cluster) => segmentBounds(cluster, connectionTolerance));
}

/** The net of each source wire, pin and label, counting joins by label name. */
function sourceNets(shapes: readonly EditorShape[]) {
	const nets = new Map<string, string>();
	for (const [index, net] of electricalNets(shapes).entries()) {
		for (const id of net.wires) nets.set(`wire ${id}`, `net ${index}`);
		for (const pin of net.pins)
			nets.set(`pin ${pin.shapeId} ${pin.pinId}`, `net ${index}`);
		for (const label of net.labels) nets.set(`label ${label}`, `net ${index}`);
	}
	return nets;
}

/**
 * What `wires` would connect to: source nets, and other diagonals as
 * `diagonal <index>`. Only shapes near the wires can touch them.
 */
function joined(
	drawing: readonly EditorShape[],
	groups: ReadonlyMap<string, string>,
	wires: readonly EditorShape[],
) {
	const box = segmentBounds(wires.flatMap(wireSegments), 1);
	const local = drawing.filter(
		(shape) =>
			(shape.kind === "wire" ||
				shape.kind === "pin" ||
				shape.kind === "symbol" ||
				(shape.kind === "text" && shape.electrical)) &&
			overlaps(shapeBounds(shape), box),
	);
	const ids = new Set(wires.map((wire) => wire.id));
	const net = electricalNets([...local, ...wires]).find((net) =>
		net.wires.some((id) => ids.has(id)),
	);
	return new Set(
		[
			...(net?.wires.filter((id) => !ids.has(id)).map((id) => `wire ${id}`) ??
				[]),
			...(net?.pins.map((pin) => `pin ${pin.shapeId} ${pin.pinId}`) ?? []),
			...(net?.labels.map((label) => `label ${label}`) ?? []),
		].map((item) => groups.get(item)),
	);
}

const sameSet = <T>(first: ReadonlySet<T>, second: ReadonlySet<T>) =>
	first.size === second.size && [...first].every((item) => second.has(item));

/**
 * ecad wires are horizontal or vertical, so each diagonal wire turns a
 * corner. A diagonal first splits wherever something connects along it in
 * the source, and each piece takes the first corner where:
 * - the new wires join exactly the nets the diagonal joined, counting nets
 *   joined by label name anywhere in the drawing; and
 * - wire normalization, which every later command runs, cannot move or
 *   delete the new wires or move or extend another wire onto them. Each new
 *   wire is at least 0.001 mm long, can merge only with wires exactly in line
 *   that it overlaps or touches, and stays clear of clusters that
 *   normalization could shift or join across a gap.
 * Returns each diagonal's wires, or undefined where a piece has no such
 * corner and the diagonal stays a graphic line.
 */
function routeDiagonalWires(
	diagonals: readonly Segment[],
	shapes: readonly EditorShape[],
): (EditorShape[] | undefined)[] {
	if (!diagonals.length) return [];
	let nextId = shapes.reduce(
		(maximum, shape) => Math.max(maximum, shape.id),
		0,
	);
	// `line` would stretch a very short wire, so set the exact length.
	const wire = (a: XY, b: XY): EditorShape => ({
		...line(a, b, "wire"),
		id: ++nextId,
		width: Math.hypot(b[0] - a[0], b[1] - a[1]),
	});
	const sourceWires = shapes.flatMap(wireSegments);
	const drift = driftAreas(sourceWires);
	// Routes join exactly what their diagonals joined, so source nets stay valid.
	const groups = new Map(sourceNets(shapes));
	const diagonal = (index: number, shape: EditorShape) => {
		groups.set(`wire ${shape.id}`, `diagonal ${index}`);
		return shape;
	};
	const sourcePoints = [
		...shapes.flatMap((shape): XY[] =>
			shape.kind === "text" && shape.electrical
				? [[shape.x, shape.y]]
				: pinTerminals(shape).map((pin): XY => [pin.x, pin.y]),
		),
		...sourceWires.flat(),
		...diagonals.flat(),
	];
	const chains = diagonals.map(([start, end]) => {
		const along = (point: XY) =>
			(point[0] - start[0]) * (end[0] - start[0]) +
			(point[1] - start[1]) * (end[1] - start[1]);
		const chain = [start];
		for (const point of sourcePoints
			.filter(
				(point) =>
					distance(point, [start, end]) <= connectionTolerance &&
					!near(point, end),
			)
			.sort((first, second) => along(first) - along(second)))
			if (!near(point, chain[chain.length - 1])) chain.push(point);
		return [...chain, end];
	});
	const current = [...shapes];
	const pending = diagonals.map(([a, b], index) => diagonal(index, wire(a, b)));
	return chains.map((chain, index) => {
		// Every other diagonal, routed or not, as it stands now.
		const drawing = [...current, ...pending.slice(index + 1)];
		const pieces: EditorShape[] = [];
		for (let stop = 1; stop < chain.length; stop++) {
			const [from, to] = [chain[stop - 1], chain[stop]];
			const existing = [...current, ...pieces].flatMap(wireSegments);
			const stable = (segment: Segment) =>
				distance(segment[0], [segment[1], segment[1]]) >= 0.001 &&
				existing.every(
					(other) =>
						!mayMerge(segment, other) || mergeKeepsShape(segment, other),
				) &&
				drift.every((area) => !overlaps(segmentBounds([segment]), area));
			const expected = joined(drawing, groups, [wire(from, to)]);
			const route = (
				[
					[to[0], from[1]],
					[from[0], to[1]],
				] as XY[]
			)
				.map((corner) => [wire(from, corner), wire(corner, to)])
				.find(
					(route) =>
						route.flatMap(wireSegments).every(stable) &&
						sameSet(joined(drawing, groups, route), expected),
				);
			if (!route) break;
			pieces.push(...route);
		}
		if (pieces.length < 2 * (chain.length - 1)) return undefined;
		for (const piece of pieces) diagonal(index, piece);
		current.push(...pieces);
		return pieces;
	});
}

function text(n: SExpr, at: XY, content: string): TextShape {
	const size = numbers(node(node(n, "effects"), "font"), "size")[0] ?? 1.27;
	const justify = node(node(n, "effects"), "justify");
	const lines = content.split("\n");
	return {
		...geometry(
			...at,
			Math.max(...lines.map((s) => s.length), 1) * size * 0.65,
			size * 1.4 * lines.length,
			radians(numbers(n, "at")[2] ?? 0),
		),
		kind: "text",
		text: content,
		fontSize: size,
		horizontalAlign: justify.includes("left")
			? "left"
			: justify.includes("right")
				? "right"
				: "center",
		verticalAlign: justify.includes("top")
			? "top"
			: justify.includes("bottom")
				? "bottom"
				: "middle",
	};
}
export function importKiCadSchematic(source: string): KiCadImportResult {
	return measurePerformance("import.kicad", () => convert(source));
}
function convert(source: string): KiCadImportResult {
	const root = parseSExpr(source);
	if (root[0] !== "kicad_sch")
		throw new Error("Expected a modern .kicad_sch document.");
	const paper = node(root, "paper");
	const sizes: Record<string, XY> = {
		A0: [1189, 841],
		A1: [841, 594],
		A2: [594, 420],
		A3: [420, 297],
		A4: [297, 210],
		A5: [210, 148],
		Letter: [279.4, 215.9],
		Legal: [355.6, 215.9],
		Ledger: [431.8, 279.4],
	};
	let sheet =
		sizes[String(paper[1])] ??
		(paper[1] === "User"
			? ([Number(paper[2]), Number(paper[3])] as XY)
			: undefined);
	if (!sheet || sheet.some((v) => !Number.isFinite(v) || v <= 0))
		throw new Error("Unsupported KiCad paper size.");
	if (paper.includes("portrait")) sheet = [sheet[1], sheet[0]];
	const world = (a: number[]): XY => {
		if (a.length < 2) throw new Error("The position is missing.");
		return [a[0] - sheet[0] / 2, sheet[1] / 2 - a[1]];
	};
	const warnings = new Set<string>([
		"Net names apply throughout this drawing. KiCad hierarchical and local power scopes are not represented.",
		"Pin electrical types, footprints, simulation settings, and other source metadata are retained in the import report, not applied to electrical analysis.",
		"Pin names and numbers use native visibility fields. KiCad label placement, font styling and overbars are approximated.",
		"No-connect markers are graphics only. Wire and pin connectivity uses ECAD geometry. Hierarchical sheets and buses are not imported.",
		"KiCad colors, line patterns, font styling, text mirroring, label outlines and pin decoration shapes are approximated. Download the import report to retain source metadata, which is not saved in the drawing.",
		"Symbol arcs use line segments. Filled polygons use outlines. No ERC or PCB validation is performed.",
	]);
	const report: KiCadImportReport = {
		version: value(root, "version"),
		sheet: { width: sheet[0], height: sheet[1] },
		metadata: [],
		components: [],
		labels: [],
		supplies: [],
		warnings: [],
		skipped: [],
		counts: {},
	};
	const supported = new Set([
		"version",
		"generator",
		"generator_version",
		"uuid",
		"paper",
		"title_block",
		"lib_symbols",
		"junction",
		"no_connect",
		"wire",
		"symbol",
		"label",
		"global_label",
		"hierarchical_label",
		"text",
		"sheet_instances",
		"embedded_fonts",
	]);
	for (const n of root.filter((n): n is SExpr => Array.isArray(n))) {
		const kind = String(n[0]);
		report.counts[kind] = (report.counts[kind] ?? 0) + 1;
		if (!supported.has(kind))
			warnings.add(
				`Unsupported sheet construct: ${kind}. Retained in report metadata.`,
			);
		if (
			!["lib_symbols", "symbol", "wire", "junction", "text", "label"].includes(
				kind,
			)
		)
			report.metadata.push(n);
	}
	const libraries = new Map(
		nodes(node(root, "lib_symbols"), "symbol").map((n) => [String(n[1]), n]),
	);
	const shapes: EditorShape[] = [];
	/**
	 * Converts and validates one source item where it is produced. A failure
	 * leaves out only that item, with a readable reason, and the import goes on.
	 */
	const attempt = <T extends { shapes: ShapeInput[] }>(
		item: string,
		convert: () => T,
	): T | undefined => {
		try {
			const converted = convert();
			const valid = converted.shapes.map((shape, index) => {
				const parsed = drawingShapeSchema.safeParse({
					...shape,
					id: shapes.length + index + 1,
				});
				if (!parsed.success)
					throw new Error(describeInvalidShape(shape, parsed.error.issues));
				return parsed.data;
			});
			shapes.push(...valid);
			return converted;
		} catch (error) {
			report.skipped.push({
				item,
				reason: sentence(errorMessage(error, "It could not be converted.")),
			});
		}
	};
	const convertSymbol = (
		instance: SExpr,
		libraryId: string,
		props: Record<string, string>,
	) => {
		const definition = libraries.get(libraryId);
		if (!definition)
			throw new Error("Its library symbol is not embedded in the schematic.");
		if (value(definition, "extends"))
			throw new Error(
				"Its library symbol extends another symbol, which is unsupported.",
			);
		const [sx, sy] = world(numbers(instance, "at"));
		const angle = numbers(instance, "at")[2] ?? 0,
			theta = radians(angle),
			mirror = value(instance, "mirror");
		const unit = Number(value(instance, "unit", "1"));
		const transform = (x: number, y: number): XY => {
			if (mirror === "y") x = -x;
			if (mirror === "x") y = -y;
			return [
				Math.cos(theta) * x - Math.sin(theta) * y,
				Math.sin(theta) * x + Math.cos(theta) * y,
			];
		};
		const children: SymbolShape[] = [];
		for (const part of nodes(definition, "symbol")) {
			const match = String(part[1]).match(/_(\d+)_(\d+)$/);
			if (!match)
				throw new Error(
					`Its library symbol has an invalid unit name, ${part[1]}.`,
				);
			if (
				![0, unit].includes(Number(match[1])) ||
				![0, Number(value(instance, "convert", "1"))].includes(Number(match[2]))
			)
				continue;
			for (const g of part
				.slice(2)
				.filter((g): g is SExpr => Array.isArray(g))) {
				const kind = String(g[0]);
				const stroke =
					Math.max(Number(value(node(g, "stroke"), "width", "0")), 0) ||
					DEFAULT_LINE_WIDTH;
				const fill = value(node(g, "fill"), "type", "none");
				if (kind === "polyline") {
					const pts = nodes(node(g, "pts"), "xy").map((p) =>
						transform(Number(p[1]), Number(p[2])),
					);
					for (let i = 1; i < pts.length; i++)
						children.push(line(pts[i - 1], pts[i], "line", stroke));
					if (fill !== "none")
						warnings.add("Filled symbol polylines are imported as outlines.");
				} else if (kind === "rectangle") {
					const a = numbers(g, "start"),
						b = numbers(g, "end");
					children.push({
						...geometry(
							...transform((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
							Math.abs(a[0] - b[0]),
							Math.abs(a[1] - b[1]),
							theta,
							stroke,
						),
						kind: "rectangle",
						filled: fill !== "none",
					});
				} else if (kind === "circle") {
					const c = numbers(g, "center"),
						diameter = Number(value(g, "radius")) * 2;
					children.push({
						...geometry(
							...transform(c[0], c[1]),
							diameter,
							diameter,
							0,
							stroke,
						),
						kind: "circle",
						filled: fill !== "none",
					});
				} else if (kind === "arc") {
					const [a, m, b] = ["start", "mid", "end"].map((k) => numbers(g, k));
					const d =
						2 *
						(a[0] * (m[1] - b[1]) +
							m[0] * (b[1] - a[1]) +
							b[0] * (a[1] - m[1]));
					if (Math.abs(d) < 1e-12) {
						warnings.add("Degenerate arcs are imported as straight lines.");
						children.push(
							line(
								transform(a[0], a[1]),
								transform(b[0], b[1]),
								"line",
								stroke,
							),
						);
						continue;
					}
					const [a2, m2, b2] = [a, m, b].map((p) => p[0] ** 2 + p[1] ** 2);
					const cx =
						(a2 * (m[1] - b[1]) + m2 * (b[1] - a[1]) + b2 * (a[1] - m[1])) / d;
					const cy =
						(a2 * (b[0] - m[0]) + m2 * (a[0] - b[0]) + b2 * (m[0] - a[0])) / d;
					const [start, mid, end] = [a, m, b].map((p) =>
						Math.atan2(p[1] - cy, p[0] - cx),
					);
					const tau = 2 * Math.PI,
						mod = (v: number) => (v + tau) % tau;
					let sweep = mod(end - start);
					if (mod(mid - start) > sweep) sweep -= tau;
					const radius = Math.hypot(a[0] - cx, a[1] - cy),
						count = Math.max(2, Math.ceil(Math.abs(sweep) / radians(10)));
					let previous = transform(a[0], a[1]);
					for (let i = 1; i <= count; i++) {
						const p = transform(
							cx + radius * Math.cos(start + (sweep * i) / count),
							cy + radius * Math.sin(start + (sweep * i) / count),
						);
						children.push(line(previous, p, "line", stroke));
						previous = p;
					}
				} else if (kind === "pin") {
					const [px, py, pa] = numbers(g, "at"),
						p = transform(px, py),
						direction = transform(Math.cos(radians(pa)), Math.sin(radians(pa)));
					const length = Number(value(g, "length", "0")),
						name = value(g, "name"),
						number = value(g, "number");
					children.push({
						...geometry(
							...p,
							2 * PIN_RADIUS,
							2 * PIN_RADIUS,
							Math.atan2(direction[1], direction[0]),
						),
						kind: "pin",
						name,
						number,
						length,
						showName:
							!hidden(g) &&
							!hidden(node(definition, "pin_names")) &&
							name !== "~",
						showNumber: !hidden(g) && !hidden(node(definition, "pin_numbers")),
					});
					if (g.includes("hide") || value(g, "hide") === "yes")
						warnings.add(
							"Hidden KiCad pins retain their terminals and leads in ECAD.",
						);
				} else if (kind === "text") {
					const at = numbers(g, "at");
					children.push({
						...text(
							g,
							transform(at[0], at[1]),
							String(g[1]).replace(
								/\$\{([^}]+)\}/g,
								(raw, key: string) => props[key] ?? raw,
							),
						),
						rotation: radians(at[2] ?? 0) + theta,
					});
				} else
					warnings.add(
						`Unsupported symbol primitive: ${kind} in ${libraryId}.`,
					);
			}
		}
		const namedSupply =
			nodes(definition, "power").length > 0 &&
			Boolean(props.Value) &&
			libraryId.split(":").at(-1) !== "PWR_FLAG";
		const texts: EditorSymbol["texts"] = [];
		const childOverrides: EditorSymbol["childOverrides"] = {};
		for (const prop of nodes(instance, "property")) {
			if (hidden(prop) || !prop[2]) continue;
			const at = world(numbers(prop, "at")),
				label = text(prop, [at[0] - sx, at[1] - sy], String(prop[2]));
			if (["Reference", "Value"].includes(String(prop[1]))) {
				const attribute = prop[1] === "Reference" ? "reference" : "value";
				childOverrides[`attribute:${attribute}`] = { rotation: label.rotation };
				texts.push({
					attribute,
					x: label.x,
					y: label.y,
					fontSize: label.fontSize,
					horizontalAlign: label.horizontalAlign,
					verticalAlign: label.verticalAlign,
				});
			} else children.push(label);
		}
		if (!children.length) throw new Error("It has no supported geometry.");
		children.forEach((c, i) => {
			c.id = i + 1;
		});
		const symbol: ShapeInput = {
			...geometry(
				sx,
				sy,
				Math.max(1, ...children.map((c) => 2 * Math.abs(c.x) + c.width)),
				Math.max(1, ...children.map((c) => 2 * Math.abs(c.y) + c.height)),
			),
			kind: "symbol",
			...(namedSupply ? { netSymbol: true } : {}),
			definitionId: `kicad.${value(instance, "uuid") || shapes.length}`,
			kicad: { libraryId, unit },
			children,
			texts,
			childOverrides,
			attributes: {
				name: "",
				reference: props.Reference ?? "",
				value: props.Value ?? "",
			},
		};
		let supply: KiCadImportReport["supplies"][number] | undefined;
		if (nodes(definition, "power").length && props.Value) {
			if (libraryId.split(":").at(-1) === "PWR_FLAG") {
				warnings.add(
					"Power flags retain their geometry but do not declare a named supply.",
				);
			} else {
				const terminals = children.filter((child) => child.kind === "pin");
				if (terminals.length !== 1)
					throw new Error(
						`A power symbol needs exactly one pin, but this one has ${terminals.length}.`,
					);
				const pin = terminals[0];
				supply = {
					reference: props.Reference ?? "",
					text: props.Value,
					x: sx + pin.x,
					y: sy + pin.y,
				};
			}
		}
		const component = {
			uuid: value(instance, "uuid"),
			libraryId,
			unit,
			rotation: angle,
			mirror,
			properties: props,
		};
		return { shapes: [symbol], component, supply };
	};
	for (const instance of nodes(root, "symbol")) {
		const libraryId = value(instance, "lib_id");
		const props = Object.fromEntries(
			nodes(instance, "property").map((p) => [String(p[1]), String(p[2])]),
		);
		report.metadata.push(instance);
		// Units of one multi-unit part share a reference.
		const unit = value(instance, "unit", "1");
		const name = `${props.Reference || libraryId}${unit === "1" ? "" : ` unit ${unit}`}`;
		const converted = attempt(
			`symbol ${props.Reference ? `${name} (${libraryId})` : name}`,
			() => convertSymbol(instance, libraryId, props),
		);
		// Components and supplies stay aligned with the imported symbols.
		if (converted) {
			report.components.push(converted.component);
			if (converted.supply) report.supplies.push(converted.supply);
		}
	}
	// Diagonal wires are routed once everything they could touch is in place.
	const diagonalWires: { item: string; segment: Segment }[] = [];
	for (const wire of nodes(root, "wire")) {
		const points = nodes(node(wire, "pts"), "xy");
		const item = `wire${locate(wire, points[0])}`;
		attempt(item, () => {
			const pts = points.map((p) => world(p.slice(1).map(Number)));
			if (pts.length !== 2)
				throw new Error(
					`A wire needs two endpoints, but this one has ${pts.length}.`,
				);
			const [start, end] = pts;
			const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
			// The schema explains non-finite coordinates, so only real diagonals wait.
			if (
				!pts.flat().every(Number.isFinite) ||
				Math.abs(Math.sin(2 * angle)) <= 1e-9
			)
				return { shapes: [line(start, end, "wire")] };
			diagonalWires.push({ item, segment: [start, end] });
			return { shapes: [] };
		});
	}
	for (const junction of nodes(root, "junction"))
		attempt(`junction${locate(junction)}`, () => {
			const diameter = Number(value(junction, "diameter", "0")) || 0.6;
			return {
				shapes: [
					{
						...geometry(
							...world(numbers(junction, "at")),
							diameter,
							diameter,
							0,
							0.1,
						),
						kind: "circle",
						filled: true,
					},
				],
			};
		});
	const labelKinds = {
		label: "label",
		global_label: "global label",
		hierarchical_label: "hierarchical label",
		text: "text",
	};
	for (const [kind, kindName] of Object.entries(labelKinds))
		for (const label of nodes(root, kind)) {
			const content = String(label[1]);
			const name = content.length > 40 ? `${content.slice(0, 40)}…` : content;
			const converted = attempt(`${kindName} "${name}"${locate(label)}`, () => {
				const at = world(numbers(label, "at"));
				return {
					shapes: [
						{
							...text(label, at, content),
							...(kind === "text" ? {} : { electrical: "net" as const }),
						},
					],
					at,
				};
			});
			if (converted && kind !== "text")
				report.labels.push({
					kind,
					text: content,
					x: converted.at[0],
					y: converted.at[1],
				});
		}
	for (const nc of nodes(root, "no_connect"))
		attempt(`no-connect marker${locate(nc)}`, () => {
			const [x, y] = world(numbers(nc, "at"));
			return {
				shapes: [
					{
						kind: "no-connect",
						x,
						y,
						width: 1.2,
						height: 1.2,
						rotation: 0,
						lineWidth: 0.1524,
					},
				],
			};
		});
	const routes = routeDiagonalWires(
		diagonalWires.map(({ segment }) => segment),
		shapes,
	);
	for (const [index, { item, segment }] of diagonalWires.entries()) {
		const route = routes[index];
		if (
			attempt(item, () => ({
				shapes: route ?? [line(segment[0], segment[1], "line")],
			}))
		)
			warnings.add(
				route
					? "Diagonal wires are imported as horizontal and vertical segments."
					: "Diagonal wires that could not turn a corner without touching another connection are imported as graphic lines.",
			);
	}
	if (!shapes.length && report.skipped.length) {
		const [first] = report.skipped;
		const more = report.skipped.length - 1;
		throw new Error(
			`Nothing could be imported. Skipped ${first.item}. ${first.reason}${more ? ` ${more} more ${more === 1 ? "item was" : "items were"} skipped too.` : ""}`,
		);
	}
	report.metadata.push(node(root, "lib_symbols"));
	report.warnings = [
		...report.skipped.map(({ item, reason }) => `Skipped ${item}. ${reason}`),
		...warnings,
	];
	return { shapes, report };
}
