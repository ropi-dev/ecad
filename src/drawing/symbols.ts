import {
	drawShape,
	type EditorSymbol,
	PIN_RADIUS,
	type PrimitiveShape,
	type SymbolText,
	shapeBounds,
} from "./shapes";
import type { Point } from "./types";

export interface SymbolDefinition {
	id: string;
	name: string;
	description: string;
	prefix: string;
	value: string;
	children: PrimitiveShape[];
	texts: SymbolText[];
}

const wire = (id: number, x1: number, y1: number, x2: number, y2: number) =>
	drawShape(id, "wire", { x: x1, y: y1 }, { x: x2, y: y2 });
const pin = (id: number, x: number, y: number) =>
	drawShape(id, "pin", { x, y }, { x, y });

// Millimetre dimensions reference KiCad Device:R/C and power:Earth.
// https://github.com/KiCad/kicad-symbols/blob/master/Device.lib
// https://github.com/KiCad/kicad-symbols/blob/master/power.lib
// Keep our horizontal orientation and centered placement origin.
const referenceDefinitions: SymbolDefinition[] = [
	{
		id: "resistor",
		name: "Resistor",
		description: "IEC resistor with two leads",
		prefix: "R",
		value: "10 kΩ",
		children: [
			wire(1, -3.81, 0, -2.54, 0),
			drawShape(2, "rectangle", { x: -2.54, y: -1.016 }, { x: 2.54, y: 1.016 }),
			wire(3, 2.54, 0, 3.81, 0),
			pin(4, -3.81, 0),
			pin(5, 3.81, 0),
		],
		texts: [
			{ attribute: "reference", x: 0, y: 2.5, fontSize: 1.3 },
			{ attribute: "value", x: 0, y: -2.5, fontSize: 1.3 },
		],
	},
	{
		id: "capacitor",
		name: "Capacitor",
		description: "Two plates with connecting leads",
		prefix: "C",
		value: "100 nF",
		children: [
			wire(1, -3.81, 0, -0.762, 0),
			wire(2, -0.762, -2.032, -0.762, 2.032),
			wire(3, 0.762, -2.032, 0.762, 2.032),
			wire(4, 0.762, 0, 3.81, 0),
			pin(5, -3.81, 0),
			pin(6, 3.81, 0),
		],
		texts: [
			{ attribute: "reference", x: 0, y: 3.5, fontSize: 1.3 },
			{ attribute: "value", x: 0, y: -3.5, fontSize: 1.3 },
		],
	},
	{
		id: "ground",
		name: "Ground",
		description: "Ground connection with three bars",
		prefix: "GND",
		value: "0 V",
		children: [
			wire(1, 0, 1.27, 0, 0),
			wire(2, -1.27, 0, 1.27, 0),
			wire(3, -0.635, -0.635, 0.635, -0.635),
			wire(4, -0.127, -1.27, 0.127, -1.27),
			pin(5, 0, 1.27),
		],
		texts: [
			{ attribute: "reference", x: 2.4, y: 0.6, fontSize: 1.3 },
			{ attribute: "value", x: 2.4, y: -1.2, fontSize: 1.3 },
		],
	},
];

export const symbolDefinitions: SymbolDefinition[] = referenceDefinitions.map(
	(definition) => {
		const terminalExtent = Math.max(
			...definition.children
				.filter((child) => child.kind === "pin")
				.flatMap((child) => [Math.abs(child.x), Math.abs(child.y)]),
		);
		const scale = 3 / terminalExtent;
		return {
			...definition,
			children: definition.children.map((child) => ({
				...child,
				x: child.x * scale,
				y: child.y * scale,
				width: child.kind === "pin" ? 2 * PIN_RADIUS : child.width * scale,
				height: child.kind === "pin" ? 2 * PIN_RADIUS : child.height * scale,
			})),
			texts: definition.texts.map((label) => ({
				...label,
				x: label.x * scale,
				y: label.y * scale,
			})),
		};
	},
);

export function createSymbol(
	id: number,
	definition: SymbolDefinition,
	position: Point,
	reference = `${definition.prefix}${id}`,
): EditorSymbol {
	const children = definition.children.map((child) => ({
		...child,
		...(child.kind === "pin"
			? { width: 2 * PIN_RADIUS, height: 2 * PIN_RADIUS }
			: {}),
		lineWidth: 0.254,
	}));
	const bounds = children.map(shapeBounds);
	return {
		id,
		kind: "symbol",
		definitionId: definition.id,
		...position,
		width:
			2 *
			Math.max(
				...bounds.flatMap((box) => [Math.abs(box.minX), Math.abs(box.maxX)]),
			),
		height:
			2 *
			Math.max(
				...bounds.flatMap((box) => [Math.abs(box.minY), Math.abs(box.maxY)]),
			),
		rotation: 0,
		lineWidth: 0.254,
		children,
		texts: definition.texts.map((label) => ({ ...label })),
		attributes: { name: definition.name, reference, value: definition.value },
	};
}
