import type { DrawingAppearance } from "#/drawing/display.ts";

export interface SchematicTheme {
	desk: string;
	paper: string;
	paperEdge: string;
	grid: string;
	sheet: string;
	appearance: Record<DrawingAppearance, string>;
}

const kicadLayerColors = {
	"F.Cu": "#c83434",
	"B.Cu": "#4d7fc4",
	"F.SilkS": "#f2eda1",
	"B.SilkS": "#e8b2a7",
	"F.Mask": "#a45fc2",
	"B.Mask": "#2aa69c",
	"F.Paste": "#b4a09a",
	"B.Paste": "#3fa7a7",
	"F.CrtYd": "#ff26e2",
	"B.CrtYd": "#26e9ff",
	"F.Fab": "#afafaf",
	"B.Fab": "#6b72a8",
} as const;
const throughHolePad = "#c9a23c";

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
		...kicadLayerColors,
		"pad-through": throughHolePad,
		"pad-hole": "#ffffff",
		"pad-number": "#1a1a1a",
	},
};

export const darkSchematicTheme: SchematicTheme = {
	desk: "#0d0f13",
	paper: "#161a21",
	paperEdge: "#3d4552",
	grid: "#2e3744",
	sheet: "#b87979",
	appearance: {
		stroke: "#76c4c0",
		pin: "#76c4c0",
		fill: "#1b2e31",
		wire: "#ef8f9c",
		highlighted: "#f6cbd1",
		selected: "#e8b77e",
		text: "#a9d8d5",
		"pin-number": "#c99aa1",
		note: "#8fb3ff",
		label: "#e8edf5",
		...kicadLayerColors,
		"pad-through": throughHolePad,
		"pad-hole": "#161a21",
		"pad-number": "#ffffff",
	},
};

/** Colours the Gerber and STEP viewers draw with, outside any drawing. */
export const viewerTheme = {
	/** The app background: a captured PNG's backdrop and the desktop window's. */
	background: "#0f1115",
	hover: "#ffd166",
	selection: "#ffcc33",
	selectionGlow: "#805000",
	/** Layers behind the focused Gerber layer. */
	unfocusedLayer: "#467386",
	ambientGround: "#566173",
	gridMajor: "#64748b",
	gridMinor: "#334155",
	/** STEP parts and Gerber layers that carry no colour of their own. */
	model: "#e8b77e",
	layer: "#dc9d51",
	layerPalette: [
		"#e8b77e",
		"#76b8e8",
		"#a99bea",
		"#78c9a5",
		"#e88ea1",
		"#d2cf7d",
	],
	/** Fill of a symbol thumbnail's body. */
	thumbnailFill: "#18282b",
} as const;
