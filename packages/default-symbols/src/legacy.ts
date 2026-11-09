import {
	fromMils,
	SYMBOL_TEXT_SIZE,
} from "@ecad/drawing-core/drawing/units.ts";
import type { DefaultSymbol, SymbolPrimitive } from "./types.ts";

export function legacySymbols(): DefaultSymbol[] {
	const line = (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
	): SymbolPrimitive => ({
		kind: "line",
		x1: fromMils(x1),
		y1: fromMils(y1),
		x2: fromMils(x2),
		y2: fromMils(y2),
	});
	const pin = (x: number, y: number): SymbolPrimitive => ({
		kind: "pin",
		name: "",
		x: fromMils(x),
		y: fromMils(y),
	});
	return [
		{
			category: "Passives",
			file: {
				format: "ecad-symbol",
				version: 1,
				units: "mm",
				id: "resistor",
				name: "Resistor",
				description: "IEC resistor with two leads",
				prefix: "R",
				value: "10k",
				shapes: [
					line(-150, 0, -100, 0),
					{
						kind: "rectangle",
						x: 0,
						y: 0,
						width: fromMils(200),
						height: fromMils(80),
					},
					line(100, 0, 150, 0),
					pin(-150, 0),
					pin(150, 0),
				],
			},
			texts: [
				{
					attribute: "reference",
					x: 0,
					y: fromMils(125),
					fontSize: SYMBOL_TEXT_SIZE,
				},
				{
					attribute: "value",
					x: 0,
					y: fromMils(-125),
					fontSize: SYMBOL_TEXT_SIZE,
				},
			],
		},
		{
			category: "Passives",
			file: {
				format: "ecad-symbol",
				version: 1,
				units: "mm",
				id: "capacitor",
				name: "Capacitor",
				description: "Two plates with connecting leads",
				prefix: "C",
				value: "100n",
				shapes: [
					line(-150, 0, -30, 0),
					line(-30, -80, -30, 80),
					line(30, -80, 30, 80),
					line(30, 0, 150, 0),
					pin(-150, 0),
					pin(150, 0),
				],
			},
			texts: [
				{
					attribute: "reference",
					x: 0,
					y: fromMils(175),
					fontSize: SYMBOL_TEXT_SIZE,
				},
				{
					attribute: "value",
					x: 0,
					y: fromMils(-175),
					fontSize: SYMBOL_TEXT_SIZE,
				},
			],
		},
		{
			category: "Power",
			file: {
				format: "ecad-symbol",
				version: 1,
				units: "mm",
				id: "ground",
				name: "Ground",
				description: "Ground connection with three bars",
				prefix: "GND",
				value: "GND",
				netSymbol: true,
				shapes: [
					line(0, 150, 0, 50),
					line(-100, 50, 100, 50),
					line(-50, 0, 50, 0),
					line(-10, -50, 10, -50),
					pin(0, 150),
				],
			},
			texts: [
				{
					attribute: "reference",
					x: fromMils(200),
					y: fromMils(100),
					fontSize: SYMBOL_TEXT_SIZE,
				},
				{
					attribute: "value",
					x: fromMils(200),
					y: fromMils(-50),
					fontSize: SYMBOL_TEXT_SIZE,
				},
			],
		},
	];
}
