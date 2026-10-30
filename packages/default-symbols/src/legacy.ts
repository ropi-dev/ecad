import type { DefaultSymbol, SymbolPrimitive } from "./types.ts";

/** Preserve the first three built-ins' IDs, order, geometry, values, and labels. */
export function legacySymbols(): DefaultSymbol[] {
	const line = (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
	): SymbolPrimitive => ({ kind: "line", x1, y1, x2, y2 });
	const pin = (x: number, y: number): SymbolPrimitive => ({
		kind: "pin",
		name: "",
		x,
		y,
	});
	const definitions = [
		{
			id: "resistor",
			name: "Resistor",
			description: "IEC resistor with two leads",
			prefix: "R",
			value: "10 kΩ",
			extent: 3.81,
			label: 2.5,
			shapes: [
				line(-3.81, 0, -2.54, 0),
				{ kind: "rectangle", x: 0, y: 0, width: 5.08, height: 2.032 },
				line(2.54, 0, 3.81, 0),
				pin(-3.81, 0),
				pin(3.81, 0),
			],
		},
		{
			id: "capacitor",
			name: "Capacitor",
			description: "Two plates with connecting leads",
			prefix: "C",
			value: "100 nF",
			extent: 3.81,
			label: 3.5,
			shapes: [
				line(-3.81, 0, -0.762, 0),
				line(-0.762, -2.032, -0.762, 2.032),
				line(0.762, -2.032, 0.762, 2.032),
				line(0.762, 0, 3.81, 0),
				pin(-3.81, 0),
				pin(3.81, 0),
			],
		},
		{
			id: "ground",
			name: "Ground",
			description: "Ground connection with three bars",
			prefix: "GND",
			value: "GND",
			extent: 1.27,
			label: 0,
			shapes: [
				line(0, 1.27, 0, 0),
				line(-1.27, 0, 1.27, 0),
				line(-0.635, -0.635, 0.635, -0.635),
				line(-0.127, -1.27, 0.127, -1.27),
				pin(0, 1.27),
			],
		},
	] satisfies {
		id: string;
		name: string;
		description: string;
		prefix: string;
		value: string;
		extent: number;
		label: number;
		shapes: SymbolPrimitive[];
	}[];
	return definitions.map(
		({ extent, label, shapes, ...metadata }): DefaultSymbol => {
			const scale = 3 / extent;
			return {
				category: metadata.id === "ground" ? "Power" : "Passives",
				file: {
					format: "ecad-symbol",
					version: 1,
					units: "mm",
					...metadata,
					...(metadata.id === "ground" ? { netSymbol: true } : {}),
					shapes: shapes.map((shape): SymbolPrimitive => {
						if ("x1" in shape)
							return {
								...shape,
								x1: shape.x1 * scale,
								y1: shape.y1 * scale,
								x2: shape.x2 * scale,
								y2: shape.y2 * scale,
							};
						if (shape.kind === "rectangle")
							return {
								...shape,
								x: shape.x * scale,
								y: shape.y * scale,
								width: shape.width * scale,
								height: shape.height * scale,
							};
						return { ...shape, x: shape.x * scale, y: shape.y * scale };
					}),
				},
				texts:
					metadata.id === "ground"
						? [
								{
									attribute: "reference",
									x: 2.4 * scale,
									y: 0.6 * scale,
									fontSize: 1.3,
								},
								{
									attribute: "value",
									x: 2.4 * scale,
									y: -1.2 * scale,
									fontSize: 1.3,
								},
							]
						: [
								{
									attribute: "reference",
									x: 0,
									y: label * scale,
									fontSize: 1.3,
								},
								{ attribute: "value", x: 0, y: -label * scale, fontSize: 1.3 },
							],
			};
		},
	);
}
