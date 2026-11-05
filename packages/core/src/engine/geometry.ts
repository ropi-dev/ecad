import earcut from "earcut";
import libtess from "libtess";
import svgParser from "svg-path-parser";
import type { Geometry, Point } from "#/engine/types.ts";

type Pair = [number, number];
type Ring = Pair[];
export type MultiPolygon = Ring[][];

interface Contour {
	points: Pair[];
	closed: boolean;
}
export interface CompiledGeometry {
	polygons: MultiPolygon;
	vertices: Float32Array;
	tolerance: number;
}

const TAU = Math.PI * 2;
const distance = (a: Pair, b: Pair) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const midpoint = (a: Pair, b: Pair): Pair => [
	(a[0] + b[0]) / 2,
	(a[1] + b[1]) / 2,
];

function segmentDistance(point: Pair, a: Pair, b: Pair): number {
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

function circleRing(
	x: number,
	y: number,
	radius: number,
	tolerance: number,
): Ring {
	if (!(radius > 0)) return [];
	const step = 2 * Math.acos(Math.max(-1, 1 - tolerance / radius));
	const count = Math.max(16, Math.min(8192, Math.ceil(TAU / step)));
	return Array.from({ length: count }, (_, index) => [
		x + radius * Math.cos((index / count) * TAU),
		y + radius * Math.sin((index / count) * TAU),
	]);
}

function flattenCubic(
	a: Pair,
	b: Pair,
	c: Pair,
	d: Pair,
	tolerance: number,
	out: Pair[],
	depth = 0,
): void {
	if (
		depth >= 18 ||
		Math.max(segmentDistance(b, a, d), segmentDistance(c, a, d)) <= tolerance
	) {
		out.push(d);
		return;
	}
	const ab = midpoint(a, b),
		bc = midpoint(b, c),
		cd = midpoint(c, d);
	const abc = midpoint(ab, bc),
		bcd = midpoint(bc, cd),
		center = midpoint(abc, bcd);
	flattenCubic(a, ab, abc, center, tolerance, out, depth + 1);
	flattenCubic(center, bcd, cd, d, tolerance, out, depth + 1);
}

function flattenArc(
	start: Pair,
	end: Pair,
	rxInput: number,
	ryInput: number,
	rotation: number,
	largeArc: boolean,
	sweep: boolean,
	tolerance: number,
	out: Pair[],
): void {
	let rx = Math.abs(rxInput),
		ry = Math.abs(ryInput);
	if (!rx || !ry || distance(start, end) < 1e-12) {
		out.push(end);
		return;
	}
	const phi = (rotation * Math.PI) / 180,
		cos = Math.cos(phi),
		sin = Math.sin(phi);
	const dx = (start[0] - end[0]) / 2,
		dy = (start[1] - end[1]) / 2;
	const x = cos * dx + sin * dy,
		y = -sin * dx + cos * dy;
	const ratio = (x * x) / (rx * rx) + (y * y) / (ry * ry);
	if (ratio > 1) {
		rx *= Math.sqrt(ratio);
		ry *= Math.sqrt(ratio);
	}
	const sign = largeArc === sweep ? -1 : 1;
	const root =
		sign *
		Math.sqrt(
			Math.max(
				0,
				(rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x) /
					(rx * rx * y * y + ry * ry * x * x),
			),
		);
	const cxLocal = (root * rx * y) / ry,
		cyLocal = (-root * ry * x) / rx;
	const cx = cos * cxLocal - sin * cyLocal + (start[0] + end[0]) / 2;
	const cy = sin * cxLocal + cos * cyLocal + (start[1] + end[1]) / 2;
	const theta = Math.atan2((y - cyLocal) / ry, (x - cxLocal) / rx);
	let delta = Math.atan2((-y - cyLocal) / ry, (-x - cxLocal) / rx) - theta;
	if (sweep && delta < 0) delta += TAU;
	if (!sweep && delta > 0) delta -= TAU;
	const step = 2 * Math.acos(Math.max(-1, 1 - tolerance / Math.max(rx, ry)));
	const count = Math.max(1, Math.min(8192, Math.ceil(Math.abs(delta) / step)));
	for (let index = 1; index < count; index++) {
		const angle = theta + (delta * index) / count;
		out.push([
			cx + cos * rx * Math.cos(angle) - sin * ry * Math.sin(angle),
			cy + sin * rx * Math.cos(angle) + cos * ry * Math.sin(angle),
		]);
	}
	out.push(end);
}

/** SVG paths use Cartesian coordinates here. The renderer, not the parser, flips Y. */
export function flattenPath(d: string, tolerance = 0.002): Contour[] {
	if (!d.trim()) return [];
	const commands = svgParser.makeAbsolute(svgParser.parseSVG(d));
	const contours: Contour[] = [];
	let current: Contour | undefined;
	let cubicControl: Pair | undefined, quadraticControl: Pair | undefined;
	let previousCode = "";
	for (const command of commands) {
		const start: Pair = [command.x0, command.y0],
			end: Pair = [command.x, command.y];
		if (command.code === "M") {
			current = { points: [end], closed: false };
			contours.push(current);
		} else {
			if (!current) {
				current = { points: [start], closed: false };
				contours.push(current);
			}
			if (command.code === "C" || command.code === "S") {
				const first: Pair =
					command.code === "C"
						? [command.x1, command.y1]
						: /[CS]/.test(previousCode) && cubicControl
							? [2 * start[0] - cubicControl[0], 2 * start[1] - cubicControl[1]]
							: start;
				cubicControl = [command.x2, command.y2];
				flattenCubic(
					start,
					first,
					cubicControl,
					end,
					tolerance,
					current.points,
				);
			} else if (command.code === "Q" || command.code === "T") {
				quadraticControl =
					command.code === "Q"
						? [command.x1, command.y1]
						: /[QT]/.test(previousCode) && quadraticControl
							? [
									2 * start[0] - quadraticControl[0],
									2 * start[1] - quadraticControl[1],
								]
							: start;
				const first: Pair = [
					start[0] + ((quadraticControl[0] - start[0]) * 2) / 3,
					start[1] + ((quadraticControl[1] - start[1]) * 2) / 3,
				];
				const second: Pair = [
					end[0] + ((quadraticControl[0] - end[0]) * 2) / 3,
					end[1] + ((quadraticControl[1] - end[1]) * 2) / 3,
				];
				flattenCubic(start, first, second, end, tolerance, current.points);
			} else if (command.code === "A") {
				flattenArc(
					start,
					end,
					command.rx,
					command.ry,
					command.xAxisRotation,
					command.largeArc,
					command.sweep,
					tolerance,
					current.points,
				);
			} else if (command.code === "Z") {
				current.closed = true;
				if (
					distance(
						current.points[0],
						current.points[current.points.length - 1],
					) > 1e-12
				)
					current.points.push(current.points[0]);
			} else current.points.push(end);
		}
		previousCode = command.code;
	}
	return contours;
}

function ringArea(ring: Ring): number {
	let area = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
		area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
	return area / 2;
}

function pointInRing(point: Pair, ring: Ring): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i],
			b = ring[j];
		if (segmentDistance(point, a, b) < 1e-10) return true;
		if (
			a[1] > point[1] !== b[1] > point[1] &&
			point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
		)
			inside = !inside;
	}
	return inside;
}

/** GLU resolves odd winding, intersections, and cut-ins before Boolean operations. */
function fillPolygons(
	contours: Contour[],
	winding = libtess.windingRule.GLU_TESS_WINDING_ODD,
): MultiPolygon {
	const tess = new libtess.GluTesselator();
	const rings: Ring[] = [];
	let ring: Ring = [];
	tess.gluTessNormal(0, 0, 1);
	tess.gluTessProperty(libtess.gluEnum.GLU_TESS_WINDING_RULE, winding);
	tess.gluTessProperty(libtess.gluEnum.GLU_TESS_BOUNDARY_ONLY, true);
	tess.gluTessCallback(libtess.gluEnum.GLU_TESS_BEGIN, () => {
		ring = [];
		rings.push(ring);
	});
	tess.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX, (vertex: Pair) =>
		ring.push(vertex),
	);
	tess.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE, (coords: number[]) => [
		coords[0],
		coords[1],
	]);
	tess.gluTessCallback(libtess.gluEnum.GLU_TESS_ERROR, (code: number) => {
		throw new Error(`Unable to tessellate path (${code})`);
	});
	tess.gluTessBeginPolygon(null);
	for (const contour of contours) {
		if (contour.points.length < 3) continue;
		tess.gluTessBeginContour();
		for (const point of contour.points)
			tess.gluTessVertex([point[0], point[1], 0], point);
		tess.gluTessEndContour();
	}
	tess.gluTessEndPolygon();
	tess.gluDeleteTess();
	const polygons = rings
		.filter((boundary) => ringArea(boundary) > 0)
		.map((boundary) => [boundary]);
	for (const hole of rings.filter((boundary) => ringArea(boundary) < 0)) {
		const shell = polygons
			.filter((polygon) => pointInRing(hole[0], polygon[0]))
			.sort((a, b) => ringArea(a[0]) - ringArea(b[0]))[0];
		if (shell) shell.push(hole);
	}
	return polygons;
}

function signedContours(polygons: MultiPolygon, sign = 1): Contour[] {
	return polygons.flatMap((polygon) =>
		polygon.map((ring, index) => {
			const direction = sign * (index === 0 ? 1 : -1);
			return {
				points:
					Math.sign(ringArea(ring)) === direction ? ring : [...ring].reverse(),
				closed: true,
			};
		}),
	);
}

/** Positive winding implements A union B or A minus B on resolved coverage. */
export function combinePolygons(
	left: MultiPolygon,
	right: MultiPolygon = [],
	subtract = false,
): MultiPolygon {
	return fillPolygons(
		[...signedContours(left), ...signedContours(right, subtract ? -1 : 1)],
		libtess.windingRule.GLU_TESS_WINDING_POSITIVE,
	);
}

function strokePolygons(
	contours: Contour[],
	width: number,
	tolerance: number,
): MultiPolygon {
	if (!(width > 0)) return [];
	const parts: MultiPolygon = [];
	const radius = width / 2;
	for (const contour of contours) {
		const points = contour.points;
		for (let index = 0; index < points.length; index++) {
			const point = points[index];
			parts.push([circleRing(point[0], point[1], radius, tolerance)]);
			if (!index) continue;
			const previous = points[index - 1],
				length = distance(previous, point);
			if (length < 1e-12) continue;
			const dx = ((point[0] - previous[0]) * radius) / length,
				dy = ((point[1] - previous[1]) * radius) / length;
			parts.push([
				[
					[previous[0] - dy, previous[1] + dx],
					[point[0] - dy, point[1] + dx],
					[point[0] + dy, point[1] - dx],
					[previous[0] + dy, previous[1] - dx],
				],
			]);
		}
	}
	// A finely flattened arc can contain hundreds of overlapping discs. Resolve
	// neighboring pieces in a balanced tree to keep intermediate tessellations small.
	const resolve = (start: number, end: number): MultiPolygon => {
		if (end - start <= 32) return combinePolygons(parts.slice(start, end));
		const middle = Math.floor((start + end) / 2);
		return combinePolygons(resolve(start, middle), resolve(middle, end));
	};
	return parts.length ? resolve(0, parts.length) : [];
}

export function triangulate(polygons: MultiPolygon): Float32Array {
	const triangles: number[] = [];
	for (const polygon of polygons) {
		const vertices: number[] = [],
			holes: number[] = [];
		for (let index = 0; index < polygon.length; index++) {
			if (index) holes.push(vertices.length / 2);
			for (const point of polygon[index]) vertices.push(point[0], point[1]);
		}
		for (const index of earcut(vertices, holes, 2))
			triangles.push(vertices[index * 2], vertices[index * 2 + 1]);
	}
	return new Float32Array(triangles);
}

export class GeometryCompiler {
	private cache = new WeakMap<Geometry, CompiledGeometry>();

	compile(geometry: Geometry, tolerance = 0.002): CompiledGeometry {
		tolerance = Math.max(0.000001, tolerance);
		const cached = this.cache.get(geometry);
		if (cached && cached.tolerance <= tolerance) return cached;
		let polygons: MultiPolygon = [];
		if (geometry.type === "circle") {
			const ring = circleRing(
				geometry.x,
				geometry.y,
				geometry.radius,
				tolerance,
			);
			polygons = ring.length ? [[ring]] : [];
		} else if (geometry.type === "rect") {
			const { x, y, width, height } = geometry,
				w = width / 2,
				h = height / 2;
			if (width > 0 && height > 0)
				polygons = [
					[
						[
							[x - w, y - h],
							[x + w, y - h],
							[x + w, y + h],
							[x - w, y + h],
						],
					],
				];
		} else if (geometry.type === "path") {
			const contours = flattenPath(geometry.d, tolerance);
			polygons = geometry.fill ? fillPolygons(contours) : [];
			if (geometry.strokeWidth) {
				const stroke = strokePolygons(
					contours,
					geometry.strokeWidth,
					tolerance,
				);
				polygons = polygons.length ? combinePolygons(polygons, stroke) : stroke;
			}
		} else {
			// Clear children remove coverage only from this isolated group.
			for (const child of geometry.children) {
				const childPolygons = this.compile(child.geometry, tolerance).polygons;
				if (!childPolygons.length) continue;
				polygons =
					child.polarity === "clear"
						? polygons.length
							? combinePolygons(polygons, childPolygons, true)
							: []
						: polygons.length
							? combinePolygons(polygons, childPolygons)
							: childPolygons;
			}
		}
		const result = { polygons, vertices: triangulate(polygons), tolerance };
		this.cache.set(geometry, result);
		return result;
	}
}

export function containsPoint(
	polygons: MultiPolygon,
	point: Point,
	tolerance = 0,
): boolean {
	const pair: Pair = [point.x, point.y];
	for (const polygon of polygons) {
		if (
			pointInRing(pair, polygon[0]) &&
			!polygon.slice(1).some((hole) => pointInRing(pair, hole))
		)
			return true;
		if (tolerance > 0)
			for (const ring of polygon)
				for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
					if (segmentDistance(pair, ring[i], ring[j]) <= tolerance) return true;
	}
	return false;
}
