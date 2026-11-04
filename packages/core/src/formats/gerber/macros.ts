import type { Point } from "#/engine/types.ts";
import {
	apertureMatrix,
	circle,
	group,
	polygon,
	rectangle,
	regularPolygon,
	transformPoint,
	type Shape,
} from "./geometry";

/** Recursive descent; Gerber expressions are data and are never evaluated as JavaScript. */
export function evaluateExpression(
	expression: string,
	variables: Map<number, number>,
): number {
	const tokens =
		expression
			.replace(/\s/g, "")
			.match(/\$\d+|(?:\d+(?:\.\d*)?|\.\d+)|[+\-xX/()]/g) ?? [];
	if (tokens.join("") !== expression.replace(/\s/g, ""))
		throw new Error(`Invalid macro expression: ${expression}`);
	let index = 0;
	function primary(): number {
		const token = tokens[index++];
		if (token === "+") return primary();
		if (token === "-") return -primary();
		if (token === "(") {
			const value = sum();
			if (tokens[index++] !== ")") throw new Error("Unclosed macro expression");
			return value;
		}
		if (token?.startsWith("$"))
			return variables.get(Number(token.slice(1))) ?? 0;
		if (token && /^(?:\d|\.)/.test(token)) return Number(token);
		throw new Error(`Expected a number in macro expression: ${expression}`);
	}
	function product(): number {
		let value = primary();
		while (/^[xX/]$/.test(tokens[index] ?? "")) {
			const op = tokens[index++];
			const rhs = primary();
			value = op === "/" ? value / rhs : value * rhs;
		}
		return value;
	}
	function sum(): number {
		let value = product();
		while (/^[+-]$/.test(tokens[index] ?? "")) {
			const op = tokens[index++];
			const rhs = product();
			value = op === "+" ? value + rhs : value - rhs;
		}
		return value;
	}
	const value = sum();
	if (index !== tokens.length || !Number.isFinite(value))
		throw new Error(`Invalid macro expression: ${expression}`);
	return value;
}

export function buildMacro(
	body: string[],
	parameters: number[],
	unit: number,
	warn: (message: string) => void,
): Shape {
	const variables = new Map(
		parameters.map((value, index) => [index + 1, value]),
	);
	const children: { shape: Shape; polarity: "dark" | "clear" }[] = [];
	for (const statement of body) {
		const text = statement.trim();
		if (!text || /^0(?:\s|$)/.test(text)) continue;
		if (text.startsWith("$")) {
			const assignment = /^\$(\d+)\s*=(.*)$/.exec(text);
			if (!assignment)
				throw new Error(`Invalid macro variable assignment: ${text}`);
			variables.set(
				Number(assignment[1]),
				evaluateExpression(assignment[2], variables),
			);
			continue;
		}
		const p = text
				.split(",")
				.map((value) => evaluateExpression(value, variables)),
			code = p.shift();
		let shape: Shape,
			exposure = 1;
		const requireCount = (minimum: number, maximum = minimum) => {
			if (p.length < minimum || p.length > maximum)
				throw new Error(
					`Macro primitive ${code} expects ${minimum === maximum ? minimum : `${minimum} to ${maximum}`} parameters; got ${p.length}`,
				);
		};
		const nonnegative = (...values: number[]) => {
			if (values.some((value) => value < 0))
				throw new Error(`Macro primitive ${code} has a negative dimension`);
		};
		if (code === 1) {
			requireCount(4, 5);
			nonnegative(p[1]);
			exposure = p[0];
			const center = transformPoint(
				{ x: p[2] * unit, y: p[3] * unit },
				apertureMatrix("N", p[4] ?? 0, 1),
			);
			shape = circle(center.x, center.y, (p[1] * unit) / 2);
		} else if (code === 20 || code === 2) {
			requireCount(7);
			nonnegative(p[1]);
			exposure = p[0];
			if (code === 2)
				warn("Deprecated macro primitive 2 was interpreted as vector line 20.");
			const a = { x: p[2] * unit, y: p[3] * unit },
				b = { x: p[4] * unit, y: p[5] * unit },
				length = Math.hypot(b.x - a.x, b.y - a.y);
			const nx = length ? ((-(b.y - a.y) / length) * p[1] * unit) / 2 : 0,
				ny = length ? (((b.x - a.x) / length) * p[1] * unit) / 2 : 0;
			const m = apertureMatrix("N", p[6], 1);
			shape = polygon(
				[
					{ x: a.x + nx, y: a.y + ny },
					{ x: b.x + nx, y: b.y + ny },
					{ x: b.x - nx, y: b.y - ny },
					{ x: a.x - nx, y: a.y - ny },
				].map((point) => transformPoint(point, m)),
			);
		} else if (code === 21 || code === 22) {
			requireCount(6);
			nonnegative(p[1], p[2]);
			exposure = p[0];
			if (code === 22)
				warn(
					"Deprecated macro primitive 22 was interpreted as a lower-left rectangle.",
				);
			shape = rectangle(
				(p[3] + (code === 22 ? p[1] / 2 : 0)) * unit,
				(p[4] + (code === 22 ? p[2] / 2 : 0)) * unit,
				p[1] * unit,
				p[2] * unit,
				p[5],
			);
		} else if (code === 4) {
			const n = p[1];
			if (!Number.isInteger(n) || n < 3 || n > 5000)
				throw new Error("Macro outline must have 3 to 5000 vertices");
			requireCount(2 * n + 5);
			exposure = p[0];
			const matrix = apertureMatrix("N", p.at(-1)!, 1),
				points: Point[] = [];
			for (let i = 0; i <= n; i++)
				points.push(
					transformPoint(
						{ x: p[2 + 2 * i] * unit, y: p[3 + 2 * i] * unit },
						matrix,
					),
				);
			if (
				Math.hypot(points[0].x - points[n].x, points[0].y - points[n].y) > 1e-8
			)
				throw new Error("Macro outline is not closed");
			shape = polygon(points);
		} else if (code === 5) {
			requireCount(6);
			nonnegative(p[4]);
			exposure = p[0];
			if (!Number.isInteger(p[1]) || p[1] < 3 || p[1] > 12)
				throw new Error("Macro polygon must have 3 to 12 vertices");
			shape = regularPolygon(p[1], p[2] * unit, p[3] * unit, p[4] * unit, p[5]);
		} else if (code === 7) {
			requireCount(6);
			nonnegative(p[3], p[4]);
			const [x, y, outer, inner, gap, rotation] = p;
			if (outer <= inner || gap >= outer / Math.SQRT2)
				throw new Error("Invalid thermal diameters or gap");
			const center = transformPoint(
				{ x: x * unit, y: y * unit },
				apertureMatrix("N", rotation, 1),
			);
			shape = group([
				{
					shape: circle(center.x, center.y, (outer * unit) / 2),
					polarity: "dark",
				},
				{
					shape: circle(center.x, center.y, (inner * unit) / 2),
					polarity: "clear",
				},
				{
					shape: rectangle(
						x * unit,
						y * unit,
						outer * unit,
						gap * unit,
						rotation,
					),
					polarity: "clear",
				},
				{
					shape: rectangle(
						x * unit,
						y * unit,
						gap * unit,
						outer * unit,
						rotation,
					),
					polarity: "clear",
				},
			]);
		} else if (code === 6) {
			requireCount(9);
			warn("Deprecated macro primitive 6 was interpreted as a moiré target.");
			const [
				x,
				y,
				outer,
				thickness,
				gap,
				count,
				crossWidth,
				crossLength,
				rotation,
			] = p;
			nonnegative(outer, thickness, gap, crossWidth, crossLength);
			if (!Number.isInteger(count) || count < 0 || count > 10000)
				throw new Error("Invalid moiré ring count");
			const center = transformPoint(
					{ x: x * unit, y: y * unit },
					apertureMatrix("N", rotation, 1),
				),
				rings: { shape: Shape; polarity: "dark" | "clear" }[] = [];
			for (let i = 0; i < count; i++) {
				const diameter = outer - i * 2 * (thickness + gap);
				if (diameter <= 0) break;
				rings.push({
					shape: group([
						{
							shape: circle(center.x, center.y, (diameter * unit) / 2),
							polarity: "dark",
						},
						{
							shape: circle(
								center.x,
								center.y,
								Math.max(0, diameter / 2 - thickness) * unit,
							),
							polarity: "clear",
						},
					]),
					polarity: "dark",
				});
			}
			rings.push(
				{
					shape: rectangle(
						x * unit,
						y * unit,
						crossLength * unit,
						crossWidth * unit,
						rotation,
					),
					polarity: "dark",
				},
				{
					shape: rectangle(
						x * unit,
						y * unit,
						crossWidth * unit,
						crossLength * unit,
						rotation,
					),
					polarity: "dark",
				},
			);
			shape = group(rings);
		} else
			throw new Error(
				`Unsupported aperture macro primitive ${code}; aperture was not rendered`,
			);
		if (exposure !== 0 && exposure !== 1)
			throw new Error(`Macro primitive ${code} exposure must be 0 or 1`);
		children.push({ shape, polarity: exposure ? "dark" : "clear" });
	}
	return group(children);
}
