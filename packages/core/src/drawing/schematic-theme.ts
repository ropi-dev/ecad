import type { DrawingAppearance } from "#/drawing/display.ts";

export interface SchematicTheme {
	desk: string;
	paper: string;
	paperEdge: string;
	grid: string;
	sheet: string;
	appearance: Record<DrawingAppearance, string>;
}

export const lightSchematicTheme: SchematicTheme = {
	desk: "#e2e1db",
	paper: "#f5f4ef",
	paperEdge: "#b5b5b5",
	grid: "#cfcec8",
	sheet: "#840000",
	appearance: {
		stroke: "#840000",
		pin: "#840000",
		fill: "#ffffc2",
		wire: "#009600",
		highlighted: "#c800c8",
		selected: "#1458d6",
		text: "#006464",
		"pin-number": "#a90000",
		note: "#0000c2",
		label: "#0f0f0f",
	},
};

export const darkSchematicTheme: SchematicTheme = {
	desk: "#111318",
	paper: "#111318",
	paperEdge: "#59616e",
	grid: "#303a49",
	sheet: "#b87979",
	appearance: {
		stroke: "#76c4c0",
		pin: "#76c4c0",
		fill: "#18282b",
		wire: "#ef8f9c",
		highlighted: "#f6cbd1",
		selected: "#e8b77e",
		text: "#76c4c0",
		"pin-number": "#76c4c0",
		note: "#76c4c0",
		label: "#76c4c0",
	},
};
