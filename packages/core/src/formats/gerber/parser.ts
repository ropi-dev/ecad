import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import type {
	Attributes,
	Bounds,
	Diagnostic,
	DiagnosticSeverity,
	FormatParser,
	Geometry,
	Matrix,
	ParseResult,
	Point,
	SceneObject,
} from "#/engine/types.ts";
import {
	GERBER_EXTENSIONS,
	hasGerberExtension,
	hasGerberSignature,
	MAX_GERBER_SOURCE_LENGTH,
} from "#/formats/gerber/detect.ts";
import {
	apertureMatrix,
	circle,
	convexHull,
	emptyBounds,
	finiteBounds,
	group,
	identity,
	multiply,
	obround,
	pointsBounds,
	polygon,
	rectangle,
	regularPolygon,
	type Shape,
	transformBounds,
	transformPoint,
	translation,
	union,
} from "#/formats/gerber/geometry.ts";
import { buildMacro } from "#/formats/gerber/macros.ts";

// Ucamco Gerber Layer Format Specification, revision 2026.05.
// https://www.ucamco.com/en/guest/downloads/gerber-format
export const GERBER_SPEC_REVISION = "2026.05";
type Polarity = "dark" | "clear";
interface Aperture {
	shape?: Shape;
	block?: SceneObject[];
	template: string;
	parameters: number[];
	attributes: Attributes;
	unit: number;
}
interface Token {
	text: string;
	extended: boolean;
	line: number;
}
type Block = { objects: SceneObject[] } & (
	| { kind: "AB"; aperture: number; attributes: Attributes }
	| { kind: "SR"; x: number; y: number; i: number; j: number }
);
interface Contour {
	d: string;
	bounds: Bounds;
	first: Point;
	last: Point;
	segments: number;
}
interface Region {
	contours: Contour[];
	active?: Contour;
	attributes: Attributes;
	polarity: Polarity;
}
const MAX_OBJECTS = 500_000;
// One malformed command per line could otherwise produce millions of entries.
const MAX_DIAGNOSTICS = 200;
/** A problem that makes the whole layer unusable, so parsing stops. */
class FatalGerberError extends Error {}
const decimalPattern = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
const number = (value: string): number => {
	if (
		!new RegExp(`^${decimalPattern}$`).test(value) ||
		!Number.isFinite(Number(value))
	)
		throw new Error(`Invalid decimal '${value}'`);
	return Number(value);
};
const cloneAttributes = (attributes: Attributes): Attributes =>
	Object.fromEntries(
		Object.entries(attributes).map(([key, value]) => [key, [...value]]),
	);
const samePoint = (a: Point, b: Point) =>
	Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

function* tokenize(
	source: string,
	report: (message: string, line: number) => void,
): Generator<Token> {
	let index = source.charCodeAt(0) === 0xfeff ? 1 : 0,
		line = 1;
	while (index < source.length) {
		if (/\s/.test(source[index])) {
			if (source[index] === "\n") line++;
			index++;
			continue;
		}
		const extended = source[index] === "%",
			startLine = line;
		if (extended) index++;
		const end = source.indexOf(extended ? "%" : "*", index);
		if (end === -1) {
			report(
				extended
					? "Unterminated extended command."
					: "Command is missing its * terminator.",
				startLine,
			);
			return;
		}
		const text = source.slice(index, end);
		line += (text.match(/\n/g) ?? []).length;
		index = end + 1;
		if (extended) {
			if (!text.trimEnd().endsWith("*"))
				report("Extended command is missing its * terminator.", startLine);
			if (text.trimStart().startsWith("AM"))
				yield { text: text.replace(/[\r\n]/g, ""), extended, line: startLine };
			else {
				let tokenLine = startLine;
				for (const part of text.split("*")) {
					if (part.trim())
						yield {
							text: part.replace(/[\r\n]/g, "").trim(),
							extended,
							line: tokenLine,
						};
					tokenLine += (part.match(/\n/g) ?? []).length;
				}
			}
		} else
			yield {
				text: text.replace(/[\r\n]/g, "").trim(),
				extended,
				line: startLine,
			};
	}
}

/**
 * Whether a deprecated image transformation leaves the image unchanged, or
 * undefined when the command is not one. Malformed values count as changes.
 */
function identityTransform(command: string): boolean | undefined {
	const values = (pattern: string) =>
		new RegExp(
			`^${pattern}(?:A(${decimalPattern}))?(?:B(${decimalPattern}))?$`,
		).exec(command);
	const all = (match: RegExpExecArray | null, expected: number) =>
		!!match &&
		match
			.slice(1)
			.every((value) => value === undefined || Number(value) === expected);
	if (command.startsWith("AS")) return command === "ASAXBY";
	if (/^(?:OF|IO)/.test(command)) return all(values("(?:OF|IO)"), 0);
	if (command.startsWith("SF")) return all(values("SF"), 1);
	if (command.startsWith("MI")) return all(values("MI"), 0);
	if (command.startsWith("IR"))
		return /^IR\d+$/.test(command) && Number(command.slice(2)) % 360 === 0;
	if (command.startsWith("IJ")) return false;
}

function decodeAttribute(value: string): string {
	return value.replace(
		/\\(?:u([\da-fA-F]{4})|U([\da-fA-F]{8}))/g,
		(_, short: string, long: string) => {
			const point = Number.parseInt(short ?? long, 16);
			if (point > 0x10ffff)
				throw new Error(`Invalid Unicode code point in attribute '${value}'`);
			return String.fromCodePoint(point);
		},
	);
}

export function parseGerber(
	source: string,
	filename = "untitled.gbr",
): ParseResult {
	const diagnostics: Diagnostic[] = [],
		metadata: Attributes = {},
		apertureAttributes: Attributes = {},
		objectAttributes: Attributes = {};
	const apertures = new Map<number, Aperture>(),
		macros = new Map<string, string[]>(),
		objects: SceneObject[] = [],
		blocks: Block[] = [];
	let unit = 1,
		units: "mm" | "in" = "mm",
		hasUnits = false,
		format:
			| {
					zero: "L" | "T";
					mode: "A" | "I";
					x: [number, number];
					y: [number, number];
			  }
			| undefined;
	let position: Point | undefined,
		selected: number | undefined,
		operation: number | undefined,
		interpolation = 1,
		quadrant = 75,
		hasQuadrant = false;
	let polarity: Polarity = "dark",
		mirror = "N",
		rotation = 0,
		scale = 1,
		region: Region | undefined,
		ended = false,
		line = 1,
		sequence = 0,
		objectCount = 0,
		isX3 = false;
	const warned = new Set<string>();
	const omitted = { warning: 0, error: 0 };
	/** `at` is null for problems with the whole file rather than one line. */
	const diagnostic = (
		severity: DiagnosticSeverity,
		message: string,
		at: number | null = line,
	) => {
		if (severity !== "fatal" && diagnostics.length >= MAX_DIAGNOSTICS) {
			omitted[severity]++;
			return;
		}
		diagnostics.push(
			at === null ? { severity, message } : { severity, message, line: at },
		);
	};
	const warn = (message: string) => {
		if (!warned.has(message)) {
			warned.add(message);
			diagnostic("warning", message);
		}
	};
	const output = () => blocks.at(-1)?.objects ?? objects;
	const emit = (object: Omit<SceneObject, "id">) => {
		if (++objectCount > MAX_OBJECTS)
			throw new FatalGerberError(
				`Object limit of ${MAX_OBJECTS.toLocaleString()} exceeded`,
			);
		output().push({ ...object, id: `gerber-${++sequence}` });
	};
	const emitShape = (
		shape: Shape,
		attrs: Attributes,
		objectPolarity = polarity,
		matrix?: Matrix,
	) => {
		const bounds = finiteBounds(shape.bounds);
		emit({
			geometry: shape.geometry,
			bounds: matrix ? transformBounds(bounds, matrix) : bounds,
			polarity: objectPolarity,
			attributes: cloneAttributes(attrs),
			...(matrix ? { transform: matrix } : {}),
		});
	};
	const needUnits = () => {
		if (!hasUnits)
			throw new Error(
				"A MO units command is required before geometry is defined",
			);
	};
	const coordinate = (raw: string, axis: "x" | "y") => {
		if (!format)
			throw new Error(
				"An FS coordinate format command is required before coordinates",
			);
		needUnits();
		if (raw.includes(".")) {
			warn("Explicit decimal coordinates are a legacy extension to Gerber.");
			return number(raw) * unit;
		}
		const digits = raw.replace(/^[+-]/, ""),
			sign = raw.startsWith("-") ? -1 : 1,
			[whole, fraction] = format[axis];
		if (digits.length > whole + fraction)
			throw new Error(
				`Coordinate '${raw}' exceeds the declared FS ${whole}.${fraction} format`,
			);
		return (
			((sign *
				Number(
					format.zero === "T" ? digits.padEnd(whole + fraction, "0") : digits,
				)) /
				10 ** fraction) *
			unit
		);
	};
	function attribute(command: string) {
		if (command.startsWith("TD")) {
			const name = command.slice(2);
			if (name) {
				delete apertureAttributes[name];
				delete objectAttributes[name];
			} else {
				for (const key of Object.keys(apertureAttributes))
					delete apertureAttributes[key];
				for (const key of Object.keys(objectAttributes))
					delete objectAttributes[key];
			}
			return;
		}
		const type = command.slice(0, 2),
			[name, ...rawValues] = command.slice(2).split(",");
		if (!name || !/^\.?[_a-zA-Z$][_a-zA-Z0-9]*$/.test(name))
			throw new Error(`Invalid Gerber attribute name '${name}'`);
		const target =
			type === "TF"
				? metadata
				: type === "TA"
					? apertureAttributes
					: objectAttributes;
		if (type === "TF" && Object.hasOwn(target, name)) {
			diagnostic(
				"error",
				`File attribute ${name} is immutable and was defined more than once.`,
			);
			return;
		}
		target[name] = rawValues.map(decodeAttribute);
		if (
			(name === ".FileFunction" && target[name][0] === "Component") ||
			/^\.C(?:Rot|Mfr|MPN|Val|Mnt|Ftp|PgN|PgD|Hgt|LbN|LbD|Sup)$/.test(name) ||
			(name === ".AperFunction" &&
				["ComponentMain", "ComponentPin", "ComponentOutline"].includes(
					target[name][0],
				))
		)
			isX3 = true;
	}
	function makeAperture(command: string) {
		needUnits();
		const match = /^ADD(\d+)([^,]+)(?:,(.*))?$/.exec(command);
		if (!match) throw new Error(`Invalid aperture definition '${command}'`);
		const id = Number(match[1]),
			template = match[2],
			p = match[3] === undefined ? [] : match[3].split("X").map(number);
		if (id < 10 || !Number.isSafeInteger(id))
			throw new Error("Aperture numbers must be integers of at least 10");
		if (apertures.has(id))
			throw new Error(`Aperture D${id} is already defined`);
		let shape: Shape, holeIndex: number | undefined;
		const sizes = (min: number, max: number) => {
			if (p.length < min || p.length > max)
				throw new Error(
					`Aperture ${template} expects ${min} to ${max} parameters`,
				);
			if (p.some((v) => !Number.isFinite(v)))
				throw new Error("Invalid aperture dimensions");
		};
		if (template === "C") {
			sizes(1, 3);
			if (p[0] < 0) throw new Error("Circle diameter must be nonnegative");
			shape = circle(0, 0, (p[0] * unit) / 2);
			holeIndex = 1;
		} else if (template === "R" || template === "O") {
			sizes(2, 4);
			if (p[0] <= 0 || p[1] <= 0)
				throw new Error(`${template} aperture dimensions must be positive`);
			shape =
				template === "R"
					? rectangle(0, 0, p[0] * unit, p[1] * unit)
					: obround(p[0] * unit, p[1] * unit);
			holeIndex = 2;
		} else if (template === "P") {
			sizes(2, 4);
			if (p[0] <= 0 || !Number.isInteger(p[1]) || p[1] < 3 || p[1] > 12)
				throw new Error(
					"Polygon needs a positive diameter and 3 to 12 vertices",
				);
			shape = regularPolygon(p[1], 0, 0, p[0] * unit, p[2] ?? 0);
			holeIndex = 3;
		} else {
			const macro = macros.get(template);
			if (!macro) throw new Error(`Undefined aperture macro '${template}'`);
			shape = buildMacro(macro, p, unit, warn);
		}
		if (holeIndex !== undefined && p[holeIndex] !== undefined) {
			const diameter = p[holeIndex];
			if (diameter < 0)
				throw new Error("Aperture hole dimensions must be nonnegative");
			if (diameter > 0) {
				const rectHole = p[holeIndex + 1] !== undefined;
				if (rectHole)
					warn(
						"Deprecated rectangular aperture holes are supported as transparent holes.",
					);
				const hole = rectHole
					? rectangle(0, 0, diameter * unit, p[holeIndex + 1] * unit)
					: circle(0, 0, (diameter * unit) / 2);
				// Hole validation is strict for circles/rectangles/obrounds, conservative for polygons.
				const limit =
					template === "C"
						? p[0]
						: template === "P"
							? p[0] * Math.cos(Math.PI / p[1])
							: Math.min(p[0], p[1]);
				if (!rectHole && diameter >= limit)
					throw new Error(
						"Aperture hole must fit strictly inside its outer shape",
					);
				if (rectHole && p[holeIndex + 1] <= 0)
					throw new Error("Rectangular aperture hole height must be positive");
				shape = group([
					{ shape, polarity: "dark" },
					{ shape: hole, polarity: "clear" },
				]);
			}
		}
		apertures.set(id, {
			shape,
			template,
			parameters: p,
			attributes: cloneAttributes(apertureAttributes),
			unit,
		});
	}
	function finishContour() {
		if (!region?.active) return;
		const contour = region.active;
		if (contour.segments) {
			if (!samePoint(contour.first, contour.last))
				diagnostic(
					"warning",
					"Region contour is not closed; a closing segment was added.",
				);
			contour.d += " Z";
			region.contours.push(contour);
		}
		region.active = undefined;
	}
	function closeRegion() {
		if (!region) throw new Error("G37 has no matching G36 region start");
		finishContour();
		if (region.contours.length) {
			const children = region.contours.map((contour) => ({
				shape: {
					geometry: { type: "path", d: contour.d, fill: true } as Geometry,
					bounds: contour.bounds,
				},
				polarity: "dark" as const,
			}));
			emitShape(
				children.length === 1 ? children[0].shape : group(children),
				region.attributes,
				region.polarity,
			);
		} else diagnostic("warning", "Empty region contains no geometry.");
		region = undefined;
	}
	function closeBlock(kind: "AB" | "SR") {
		const block = blocks.at(-1);
		if (!block || block.kind !== kind)
			throw new Error(`${kind} close command has no matching open command`);
		if (region) throw new Error(`Cannot close ${kind} inside a region`);
		blocks.pop();
		if (block.kind === "AB")
			apertures.set(block.aperture, {
				block: block.objects,
				template: "AB",
				parameters: [],
				attributes: block.attributes,
				unit,
			});
		else {
			const count = block.x * block.y * block.objects.length;
			if (count + objectCount > MAX_OBJECTS)
				throw new FatalGerberError(
					`Step and repeat exceeds the ${MAX_OBJECTS.toLocaleString()} object limit`,
				);
			// Repeat complete blocks in Y first, then X. Polarity makes this order significant.
			for (let x = 0; x < block.x; x++)
				for (let y = 0; y < block.y; y++) {
					const m = translation(x * block.i, y * block.j);
					for (const object of block.objects)
						emit({
							...object,
							transform: multiply(m, object.transform ?? identity),
							bounds: transformBounds(object.bounds, m),
							attributes: cloneAttributes(object.attributes),
						});
				}
		}
		position = undefined;
	}
	function flash(point: Point) {
		const aperture =
			selected === undefined ? undefined : apertures.get(selected);
		if (!aperture)
			throw new Error(
				selected === undefined
					? "Flash has no selected aperture"
					: `Aperture D${selected} is undefined`,
			);
		const m = multiply(
			translation(point.x, point.y),
			apertureMatrix(mirror, rotation, scale),
		);
		const attributes = { ...aperture.attributes, ...objectAttributes };
		if (aperture.block) {
			for (const child of aperture.block)
				emit({
					...child,
					polarity:
						polarity === "clear"
							? child.polarity === "dark"
								? "clear"
								: "dark"
							: child.polarity,
					transform: multiply(m, child.transform ?? identity),
					bounds: transformBounds(child.bounds, m),
					attributes: cloneAttributes({ ...child.attributes, ...attributes }),
				});
		} else {
			if (!aperture.shape) throw new Error("Aperture has no shape");
			emitShape(aperture.shape, attributes, polarity, m);
		}
	}
	function arc(
		start: Point,
		end: Point,
		i: number,
		j: number,
	): { segment: string; bounds: Bounds } {
		if (!hasQuadrant)
			warn("Arc appeared before G75/G74; interpreted in multi-quadrant mode.");
		const ccw = interpolation === 3,
			tau = 2 * Math.PI;
		const sweepAngle = (center: Point) => {
			const a = Math.atan2(start.y - center.y, start.x - center.x),
				b = Math.atan2(end.y - center.y, end.x - center.x);
			let delta = ccw ? (b - a + tau) % tau : (a - b + tau) % tau;
			if (samePoint(start, end)) delta = tau;
			return { a, delta };
		};
		let center = { x: start.x + i, y: start.y + j };
		if (quadrant === 74) {
			const candidates = [...new Set([i, -i])]
				.flatMap((dx) =>
					[...new Set([j, -j])].map((dy) => ({
						x: start.x + dx,
						y: start.y + dy,
					})),
				)
				.filter((c) => sweepAngle(c).delta <= Math.PI / 2 + 1e-6)
				.sort(
					(a, b) =>
						Math.abs(
							Math.hypot(start.x - a.x, start.y - a.y) -
								Math.hypot(end.x - a.x, end.y - a.y),
						) -
						Math.abs(
							Math.hypot(start.x - b.x, start.y - b.y) -
								Math.hypot(end.x - b.x, end.y - b.y),
						),
				);
			if (!candidates.length)
				throw new Error("No valid single-quadrant arc center");
			center = candidates[0];
		}
		const r0 = Math.hypot(start.x - center.x, start.y - center.y),
			r1 = Math.hypot(end.x - center.x, end.y - center.y),
			{ a, delta } = sweepAngle(center),
			direction = ccw ? 1 : -1;
		if (r0 === 0 || r1 === 0)
			throw new Error("Arc center coincides with its start or end point");
		const mismatch = Math.abs(r0 - r1),
			radius = Math.max(r0, r1);
		if (mismatch > Math.max(0.005, radius * 0.001))
			warn(
				`Arc radii differ by ${mismatch.toFixed(6)} mm; the arc is interpolated within the Gerber arc tolerance band.`,
			);
		const points = [start, end];
		for (let q = 0; q < 4; q++) {
			const angle = (q * Math.PI) / 2,
				progress = ccw ? (angle - a + tau) % tau : (a - angle + tau) % tau;
			if (progress <= delta + 1e-9)
				points.push({
					x: center.x + radius * Math.cos(angle),
					y: center.y + radius * Math.sin(angle),
				});
		}
		let segment = "";
		if (mismatch > 1e-7) {
			// A radial interpolation stays inside the permitted arc deviation band.
			const step = 2 * Math.acos(Math.max(-1, 1 - 0.0005 / radius)),
				count = Math.min(
					8192,
					Math.max(2, Math.ceil(delta / Math.max(step, 0.001))),
				);
			for (let n = 1; n <= count; n++) {
				const angle = a + (direction * delta * n) / count,
					r = r0 + ((r1 - r0) * n) / count;
				const p =
					n === count
						? end
						: {
								x: center.x + r * Math.cos(angle),
								y: center.y + r * Math.sin(angle),
							};
				segment += ` L${p.x} ${p.y}`;
			}
		} else if (delta > Math.PI * 1.999 || samePoint(start, end)) {
			const middle = {
				x: center.x + r0 * Math.cos(a + (direction * delta) / 2),
				y: center.y + r0 * Math.sin(a + (direction * delta) / 2),
			};
			segment = ` A${r0} ${r0} 0 0 ${ccw ? 1 : 0} ${middle.x} ${middle.y} A${r0} ${r0} 0 0 ${ccw ? 1 : 0} ${end.x} ${end.y}`;
		} else
			segment = ` A${r0} ${r0} 0 ${delta > Math.PI ? 1 : 0} ${ccw ? 1 : 0} ${end.x} ${end.y}`;
		return { segment, bounds: pointsBounds(points) };
	}
	function plot(start: Point, end: Point, offsetI: number, offsetJ: number) {
		const path =
			interpolation === 1
				? { segment: ` L${end.x} ${end.y}`, bounds: pointsBounds([start, end]) }
				: arc(start, end, offsetI, offsetJ);
		if (region) {
			if (!region.active) {
				diagnostic("error", "Region contour must begin with D02.");
				region.active = {
					d: `M${start.x} ${start.y}`,
					bounds: pointsBounds([start]),
					first: start,
					last: start,
					segments: 0,
				};
			}
			region.active.d += path.segment;
			region.active.bounds = union(region.active.bounds, path.bounds);
			region.active.last = end;
			region.active.segments++;
			return;
		}
		const aperture =
			selected === undefined ? undefined : apertures.get(selected);
		if (!aperture)
			throw new Error(
				selected === undefined
					? "Draw has no selected aperture"
					: `Aperture D${selected} is undefined`,
			);
		const attrs = { ...aperture.attributes, ...objectAttributes },
			p = aperture.parameters;
		if (aperture.template === "C" && (p[1] ?? 0) === 0) {
			const width = p[0] * aperture.unit * scale,
				b = path.bounds;
			const shape: Shape = {
				geometry: {
					type: "path",
					d: `M${start.x} ${start.y}${path.segment}`,
					fill: false,
					strokeWidth: width,
				},
				bounds: {
					minX: b.minX - width / 2,
					minY: b.minY - width / 2,
					maxX: b.maxX + width / 2,
					maxY: b.maxY + width / 2,
				},
			};
			if (samePoint(start, end) && interpolation === 1)
				emitShape(circle(start.x, start.y, width / 2), attrs);
			else emitShape(shape, attrs);
		} else if (
			aperture.template === "R" &&
			interpolation === 1 &&
			(p[2] ?? 0) === 0
		) {
			warn("Deprecated rectangular-aperture linear draws are supported.");
			const m = apertureMatrix(mirror, rotation, scale),
				w = (p[0] * aperture.unit) / 2,
				h = (p[1] * aperture.unit) / 2;
			const corners = [
				{ x: -w, y: -h },
				{ x: w, y: -h },
				{ x: w, y: h },
				{ x: -w, y: h },
			].map((point) => transformPoint(point, m));
			emitShape(
				polygon(
					convexHull(
						[start, end].flatMap((point) =>
							corners.map((c) => ({ x: point.x + c.x, y: point.y + c.y })),
						),
					),
				),
				attrs,
			);
		} else
			throw new Error(
				`D01 with aperture D${selected} (${aperture.template}) is unsupported: modern Gerber draws require a solid circle${interpolation === 1 ? " or a legacy solid rectangle" : ""}`,
			);
	}
	function extended(command: string) {
		if (/^(TF|TA|TO|TD)/.test(command)) {
			if (region)
				throw new Error("Attribute commands are not allowed inside a region");
			attribute(command);
			return;
		}
		const compact = command.replace(/[ \t]/g, "");
		if (compact.startsWith("FS")) {
			const m = /^FS([LT])([AI])X([1-6])([0-6])Y([1-6])([0-6])$/.exec(compact);
			if (!m)
				throw new Error(
					`Unsupported or invalid coordinate format '${compact}'`,
				);
			format = {
				zero: m[1] as "L" | "T",
				mode: m[2] as "A" | "I",
				x: [Number(m[3]), Number(m[4])],
				y: [Number(m[5]), Number(m[6])],
			};
			if (m[1] === "T" || m[2] === "I")
				warn(
					"Deprecated trailing-zero suppression or incremental coordinates are supported.",
				);
			return;
		}
		if (/^MO(MM|IN)$/.test(compact)) {
			units = compact === "MOIN" ? "in" : "mm";
			unit = units === "in" ? 25.4 : 1;
			hasUnits = true;
			return;
		}
		if (compact.startsWith("ADD")) {
			makeAperture(compact);
			return;
		}
		if (command.startsWith("AM")) {
			const [name, ...body] = command.slice(2).split("*");
			if (!/^[_a-zA-Z$][_a-zA-Z0-9]*$/.test(name))
				throw new Error(`Invalid aperture macro name '${name}'`);
			if (macros.has(name))
				throw new Error(`Aperture macro '${name}' is already defined`);
			macros.set(name, body);
			return;
		}
		if (/^LP[DC]$/.test(compact)) {
			if (region) throw new Error("LP is not allowed inside a region");
			polarity = compact === "LPD" ? "dark" : "clear";
			return;
		}
		if (/^LM(N|X|Y|XY)$/.test(compact)) {
			mirror = compact.slice(2);
			return;
		}
		if (compact.startsWith("LR")) {
			rotation = number(compact.slice(2));
			return;
		}
		if (compact.startsWith("LS")) {
			const nextScale = number(compact.slice(2));
			if (nextScale <= 0) throw new Error("Aperture scale must be positive");
			scale = nextScale;
			return;
		}
		if (compact === "AB") {
			closeBlock("AB");
			return;
		}
		if (/^ABD\d+$/.test(compact)) {
			if (region)
				throw new Error("Cannot open an aperture block inside a region");
			const id = Number(compact.slice(3));
			if (
				id < 10 ||
				apertures.has(id) ||
				blocks.some((block) => block.kind === "AB" && block.aperture === id)
			)
				throw new Error(`Invalid or duplicate block aperture D${id}`);
			blocks.push({
				kind: "AB",
				objects: [],
				aperture: id,
				attributes: cloneAttributes(apertureAttributes),
			});
			position = undefined;
			return;
		}
		if (compact === "SR") {
			closeBlock("SR");
			return;
		}
		if (compact.startsWith("SR")) {
			if (region || blocks.length)
				throw new Error(
					"Step and repeat cannot be nested or opened inside an aperture block or region",
				);
			needUnits();
			const m = new RegExp(
				`^SRX(\\d+)Y(\\d+)I(${decimalPattern})J(${decimalPattern})$`,
			).exec(compact);
			if (!m) throw new Error(`Invalid step-and-repeat command '${compact}'`);
			const x = Number(m[1]),
				y = Number(m[2]),
				i = number(m[3]) * unit,
				j = number(m[4]) * unit;
			if (x < 1 || y < 1 || i < 0 || j < 0)
				throw new Error("Invalid step-and-repeat counts or distances");
			// Drawing the block once instead would misrepresent the panel.
			if (x * y > MAX_OBJECTS)
				throw new FatalGerberError(
					`Step and repeat exceeds the ${MAX_OBJECTS.toLocaleString()} object limit`,
				);
			blocks.push({ kind: "SR", objects: [], x, y, i, j });
			return;
		}
		if (/^IN/.test(compact)) {
			metadata.ImageName = [decodeAttribute(command.slice(2))];
			return;
		}
		if (/^LN/.test(compact)) {
			warn("Deprecated LN layer-name command was retained as metadata.");
			metadata.LayerName = [decodeAttribute(command.slice(2))];
			return;
		}
		if (compact === "IPPOS") {
			warn("Deprecated positive image polarity IPPOS was accepted.");
			return;
		}
		if (compact === "IPNEG")
			throw new FatalGerberError(
				"Legacy negative image polarity IPNEG is unsupported; the image would render inverted",
			);
		const identity = identityTransform(compact);
		if (identity) {
			warn("Deprecated identity image transformation was accepted.");
			return;
		}
		// Skipping these would draw the whole image moved, scaled or mirrored.
		if (identity === false)
			throw new FatalGerberError(
				`Image transformation '${compact.slice(0, 80)}' is unsupported; the image would render transformed incorrectly`,
			);
		throw new Error(
			`Unsupported or malformed extended command '${command.slice(0, 80)}' was skipped`,
		);
	}
	function standard(command: string) {
		if (/^G0?4(?:[^\d]|$)/.test(command)) {
			const attr = /^G0?4\s*#@!\s*(T[FAOD].*)$/.exec(command);
			if (attr) attribute(attr[1].trim());
			return;
		}
		let compact = command.replace(/[ \t]/g, "");
		if (/^M0?[012]$/.test(compact)) {
			if (compact !== "M02" && compact !== "M2")
				warn("Legacy end-of-file code was accepted.");
			if (region || blocks.length)
				diagnostic(
					"error",
					"End of file appeared inside an unclosed region or block.",
				);
			ended = true;
			return;
		}
		const codes = [...compact.matchAll(/G(\d+)/g)];
		for (const match of codes) {
			const code = Number(match[1]);
			if (code === 1 || code === 2 || code === 3) interpolation = code;
			else if (code === 74 || code === 75) {
				quadrant = code;
				hasQuadrant = true;
				if (code === 74)
					warn("Deprecated G74 single-quadrant arcs are supported.");
			} else if (code === 36) {
				if (region) throw new Error("Nested regions are invalid");
				region = {
					contours: [],
					attributes: cloneAttributes({
						...apertureAttributes,
						...objectAttributes,
					}),
					polarity,
				};
			} else if (code === 37) closeRegion();
			else if (code === 54 || code === 55)
				warn("Deprecated aperture preparation G54/G55 was accepted.");
			else if (code === 70 || code === 71) {
				units = code === 70 ? "in" : "mm";
				unit = code === 70 ? 25.4 : 1;
				hasUnits = true;
				warn("Deprecated G70/G71 unit selection was accepted.");
			} else if (code === 90 || code === 91) {
				if (!format) throw new Error("G90/G91 requires a coordinate format");
				format.mode = code === 90 ? "A" : "I";
				warn("Deprecated G90/G91 coordinate mode was accepted.");
			} else throw new Error(`Unsupported G-code G${code}`);
		}
		compact = compact.replace(/G\d+/g, "");
		if (!compact) return;
		const tokens = [
			...compact.matchAll(/([XYIJD])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g),
		];
		if (tokens.map((match) => match[0]).join("") !== compact)
			throw new Error(
				`Unsupported or malformed command '${command.slice(0, 100)}'`,
			);
		const fields: Record<string, string> = {};
		for (const match of tokens) {
			if (fields[match[1]] !== undefined)
				throw new Error(`Duplicate ${match[1]} word`);
			fields[match[1]] = match[2];
		}
		const code = fields.D === undefined ? operation : Number(fields.D);
		if (code !== undefined && code >= 10) {
			if (Object.keys(fields).length !== 1 || !Number.isInteger(code))
				throw new Error(
					"Aperture selection must be a standalone integer D-code",
				);
			selected = code;
			if (!apertures.has(code))
				diagnostic("error", `Selected undefined aperture D${code}.`);
			return;
		}
		if (code !== 1 && code !== 2 && code !== 3)
			throw new Error("Coordinate operation needs D01, D02 or D03");
		operation = code;
		if (fields.D === undefined)
			warn("Deprecated modal D01/D02/D03 operations are supported.");
		if (!position && (fields.X === undefined || fields.Y === undefined))
			throw new Error(
				"Both X and Y are required when the current point is undefined",
			);
		const old = position;
		const current = position ?? { x: 0, y: 0 };
		const x = fields.X === undefined ? current.x : coordinate(fields.X, "x"),
			y = fields.Y === undefined ? current.y : coordinate(fields.Y, "y");
		const next = {
			x: format?.mode === "I" && fields.X !== undefined ? x + (old?.x ?? 0) : x,
			y: format?.mode === "I" && fields.Y !== undefined ? y + (old?.y ?? 0) : y,
		};
		const offsetI = fields.I === undefined ? 0 : coordinate(fields.I, "x"),
			offsetJ = fields.J === undefined ? 0 : coordinate(fields.J, "y");
		position = next;
		if (code === 2) {
			if (region) {
				finishContour();
				region.active = {
					d: `M${next.x} ${next.y}`,
					bounds: pointsBounds([next]),
					first: next,
					last: next,
					segments: 0,
				};
			}
		} else if (code === 3) {
			if (region) throw new Error("D03 flash is not allowed inside a region");
			flash(next);
		} else {
			if (!old)
				throw new Error("D01 draw requires a current point set by D02 or D03");
			plot(old, next, offsetI, offsetJ);
		}
	}
	// A fatal problem rejects the layer, so later diagnostics would be noise.
	let stopped = source.length > MAX_GERBER_SOURCE_LENGTH;
	if (stopped)
		diagnostic(
			"fatal",
			`Gerber file exceeds the ${MAX_GERBER_SOURCE_LENGTH / 1024 / 1024} MiB parser limit.`,
			null,
		);
	else
		for (const token of tokenize(source, (message, at) =>
			diagnostic("error", message, at),
		)) {
			line = token.line;
			if (ended) {
				diagnostic("error", "Data appears after the end-of-file command.");
				break;
			}
			try {
				token.extended ? extended(token.text) : standard(token.text);
			} catch (error) {
				stopped = error instanceof FatalGerberError;
				diagnostic(stopped ? "fatal" : "error", errorMessage(error));
				if (stopped) break;
			}
		}
	if (!stopped) {
		if (!ended)
			diagnostic(
				"warning",
				"Missing M02 end-of-file command; the file may be truncated.",
			);
		if (region)
			diagnostic("error", "Unclosed G36/G37 region was not rendered.");
		if (blocks.length)
			diagnostic(
				"error",
				`Unclosed ${blocks.map((block) => block.kind).join(", ")} block was not rendered.`,
			);
		if (!hasUnits)
			diagnostic(
				"fatal",
				"Missing MO units declaration, so no coordinates can be read.",
				null,
			);
		if (!format)
			diagnostic(
				"fatal",
				"Missing FS coordinate format declaration, so no coordinates can be read.",
				null,
			);
	}
	for (const severity of ["error", "warning"] as const) {
		const count = omitted[severity];
		if (count)
			diagnostics.push({
				severity,
				message: `${count.toLocaleString()} more ${severity}${count === 1 ? " is" : "s are"} not listed.`,
				count,
			});
	}
	const bounds = finiteBounds(
		objects
			.filter((object) => object.polarity === "dark")
			.reduce((b, object) => union(b, object.bounds), emptyBounds()),
	);
	return {
		object: {
			type: "planar",
			id: `gerber-${filename}`,
			name: filename,
			objects,
			bounds,
			color: "#dc9d51",
			visible: true,
			opacity: 1,
			metadata,
		},
		diagnostics,
		format: isX3
			? "Gerber X3"
			: Object.keys(metadata).length ||
					Object.keys(apertureAttributes).length ||
					objects.some((object) => Object.keys(object.attributes).length)
				? "Gerber X2"
				: "Gerber RS-274X",
		units,
	};
}

export const gerberParser: FormatParser = {
	id: "gerber",
	extensions: GERBER_EXTENSIONS,
	detect: (source, filename) =>
		hasGerberSignature(source) ||
		(hasGerberExtension(filename) && /(?:D0?[123]\*|M0?2\*|G0?4)/.test(source)),
	parse: parseGerber,
};
