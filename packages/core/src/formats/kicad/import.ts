import { drawingShapeSchema } from "#/drawing/schema.ts";
import type {
	EditorShape,
	EditorSymbol,
	SymbolShape,
	TextShape,
} from "#/drawing/shapes.ts";
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
	warnings: string[];
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
	lineWidth = 0.18,
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
	stroke = 0.18,
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
		if (a.length < 2) throw new Error("Missing KiCad position.");
		return [a[0] - sheet[0] / 2, sheet[1] / 2 - a[1]];
	};
	const warnings = new Set<string>([
		"Net labels and power names are visible text only. Matching names do not connect separate wires.",
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
		warnings: [],
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
	const add = (s: EditorShape) => shapes.push({ ...s, id: shapes.length + 1 });
	for (const instance of nodes(root, "symbol")) {
		const libraryId = value(instance, "lib_id");
		const definition = libraries.get(libraryId);
		if (!definition) throw new Error(`Missing embedded symbol: ${libraryId}.`);
		if (value(definition, "extends"))
			throw new Error(
				`Inherited symbol definitions are unsupported: ${libraryId}.`,
			);
		const props = Object.fromEntries(
			nodes(instance, "property").map((p) => [String(p[1]), String(p[2])]),
		);
		const [sx, sy] = world(numbers(instance, "at"));
		const angle = numbers(instance, "at")[2] ?? 0,
			theta = radians(angle),
			mirror = value(instance, "mirror");
		const unit = Number(value(instance, "unit", "1"));
		report.components.push({
			uuid: value(instance, "uuid"),
			libraryId,
			unit,
			rotation: angle,
			mirror,
			properties: props,
		});
		report.metadata.push(instance);
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
			if (!match) throw new Error(`Invalid embedded symbol unit: ${part[1]}.`);
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
					Math.max(Number(value(node(g, "stroke"), "width", "0")), 0) || 0.18;
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
							0.508,
							0.508,
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
		if (!children.length)
			throw new Error(
				`Symbol ${props.Reference ?? libraryId} has no supported geometry.`,
			);
		children.forEach((c, i) => {
			c.id = i + 1;
		});
		add({
			...geometry(
				sx,
				sy,
				Math.max(1, ...children.map((c) => 2 * Math.abs(c.x) + c.width)),
				Math.max(1, ...children.map((c) => 2 * Math.abs(c.y) + c.height)),
			),
			kind: "symbol",
			definitionId: `kicad.${value(instance, "uuid") || shapes.length}`,
			children,
			texts,
			childOverrides,
			attributes: {
				name: "",
				reference: props.Reference ?? "",
				value: props.Value ?? "",
			},
		});
	}
	for (const wire of nodes(root, "wire")) {
		const pts = nodes(node(wire, "pts"), "xy").map((p) =>
			world(p.slice(1).map(Number)),
		);
		if (pts.length !== 2) throw new Error("KiCad wires require two endpoints.");
		add(line(pts[0], pts[1], "wire") as EditorShape);
	}
	for (const junction of nodes(root, "junction")) {
		const diameter = Number(value(junction, "diameter", "0")) || 0.6;
		add({
			...geometry(
				...world(numbers(junction, "at")),
				diameter,
				diameter,
				0,
				0.1,
			),
			kind: "circle",
			filled: true,
		});
	}
	for (const kind of ["label", "global_label", "hierarchical_label", "text"])
		for (const label of nodes(root, kind)) {
			const at = world(numbers(label, "at"));
			add(text(label, at, String(label[1])));
			if (kind !== "text")
				report.labels.push({
					kind,
					text: String(label[1]),
					x: at[0],
					y: at[1],
				});
		}
	for (const nc of nodes(root, "no_connect")) {
		const [x, y] = world(numbers(nc, "at"));
		for (const sign of [-1, 1])
			add(
				line(
					[x - 0.6, y - sign * 0.6],
					[x + 0.6, y + sign * 0.6],
				) as EditorShape,
			);
	}
	report.metadata.push(node(root, "lib_symbols"));
	report.warnings = [...warnings];
	return { shapes: shapes.map((s) => drawingShapeSchema.parse(s)), report };
}
