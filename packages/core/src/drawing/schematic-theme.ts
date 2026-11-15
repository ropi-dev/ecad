import type { DrawingAppearance } from "#/drawing/display.ts";

export interface SchematicTheme {
	desk: string;
	paper: string;
	paperEdge: string;
	grid: string;
	gridMajor: string;
	sheet: string;
	appearance: Record<DrawingAppearance, string>;
}

const darkLayerColors = {
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
	"Edge.Cuts": "#d0d239",
} as const;
const lightLayerColors: Record<keyof typeof darkLayerColors, string> = {
	"F.Cu": "#c83434",
	"B.Cu": "#3b6fb8",
	"F.SilkS": "#3f3c0f",
	"B.SilkS": "#5e3028",
	"F.Mask": "#9a4fba",
	"B.Mask": "#1f9288",
	"F.Paste": "#8f776f",
	"B.Paste": "#2f8f8f",
	"F.CrtYd": "#d318bb",
	"B.CrtYd": "#0e9fb3",
	"F.Fab": "#757575",
	"B.Fab": "#5a61a0",
	"Edge.Cuts": "#8d8f12",
};
const throughHolePad = "#c9a23c";

export const printSchematicTheme: SchematicTheme = {
	desk: "#e2e1db",
	paper: "#f5f4ef",
	paperEdge: "#b5b5b5",
	grid: "#cfcec8",
	gridMajor: "#a8a7a1",
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
		...darkLayerColors,
		"pad-through": throughHolePad,
		via: "#8c8c8c",
		"pad-hole": "#ffffff",
		"pad-number": "#1a1a1a",
		ratsnest: "#3c3c3c",
	},
};

export const lightSchematicTheme: SchematicTheme = {
	desk: "#e2e5e9",
	paper: "#fcfcfa",
	paperEdge: "#b4bbc5",
	grid: "#c5cbd3",
	gridMajor: "#8f98a5",
	sheet: "#a85454",
	appearance: {
		stroke: "#157a74",
		pin: "#157a74",
		fill: "#dff0ee",
		wire: "#cf3f58",
		highlighted: "#8c1230",
		selected: "#9a5510",
		text: "#2d6461",
		"pin-number": "#a05060",
		note: "#2458c9",
		label: "#181c22",
		...lightLayerColors,
		"pad-through": "#a8801a",
		via: "#8a8a8a",
		"pad-hole": "#30353d",
		"pad-number": "#ffffff",
		ratsnest: "#3a3a3a",
	},
};

export const darkSchematicTheme: SchematicTheme = {
	desk: "#0d0f13",
	paper: "#161a21",
	paperEdge: "#3d4552",
	grid: "#2e3744",
	gridMajor: "#3c4758",
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
		...darkLayerColors,
		"pad-through": throughHolePad,
		via: "#c4c4c4",
		"pad-hole": "#161a21",
		"pad-number": "#ffffff",
		ratsnest: "#e6e6e6",
	},
};

/** Colours the Gerber and STEP viewers draw with, outside any drawing. */
export interface ViewerTheme {
	/** The app background: a captured PNG's backdrop and the desktop window's. */
	background: string;
	hover: string;
	selection: string;
	selectionGlow: string;
	/** Layers behind the focused Gerber layer. */
	unfocusedLayer: string;
	unfocusedAdditive: boolean;
	gridMajor: string;
	gridMinor: string;
	layerPalette: readonly string[];
	/** Fill of a symbol thumbnail's body. */
	thumbnailFill: string;
}

export const darkViewerTheme: ViewerTheme = {
	background: "#0f1115",
	hover: "#ffd166",
	selection: "#ffcc33",
	selectionGlow: "#805000",
	unfocusedLayer: "#467386",
	unfocusedAdditive: true,
	gridMajor: "#64748b",
	gridMinor: "#334155",
	layerPalette: [
		"#e8b77e",
		"#76b8e8",
		"#a99bea",
		"#78c9a5",
		"#e88ea1",
		"#d2cf7d",
	],
	thumbnailFill: "#18282b",
};

export const lightViewerTheme: ViewerTheme = {
	background: "#eceef1",
	hover: "#f59e0b",
	selection: "#e07b00",
	selectionGlow: "#7a3c00",
	unfocusedLayer: "#3f6a7c",
	unfocusedAdditive: false,
	gridMajor: "#8e9aab",
	gridMinor: "#c4ccd6",
	layerPalette: [
		"#b9772a",
		"#2f7fc0",
		"#6f5bd0",
		"#2f9469",
		"#c94b68",
		"#8f8b1f",
	],
	thumbnailFill: "#dff0ee",
};

export const sharedViewerColors = {
	ambientGround: "#566173",
	/** STEP parts and Gerber layers that carry no colour of their own. */
	model: "#e8b77e",
	layer: "#dc9d51",
} as const;

export type ThemeName = "light" | "dark";

export const schematicThemes: Record<ThemeName, SchematicTheme> = {
	light: lightSchematicTheme,
	dark: darkSchematicTheme,
};
export const viewerThemes: Record<ThemeName, ViewerTheme> = {
	light: lightViewerTheme,
	dark: darkViewerTheme,
};

let active: ThemeName = "dark";

export const activeTheme = (): ThemeName => active;
export function setActiveTheme(next: ThemeName) {
	active = next;
}
export const schematicTheme = (): SchematicTheme => schematicThemes[active];
export const viewerTheme = (): ViewerTheme => viewerThemes[active];
