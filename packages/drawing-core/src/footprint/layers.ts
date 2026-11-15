export const footprintLayers = [
	"F.Cu",
	"B.Cu",
	"F.SilkS",
	"B.SilkS",
	"F.Mask",
	"B.Mask",
	"F.Paste",
	"B.Paste",
	"F.CrtYd",
	"B.CrtYd",
	"F.Fab",
	"B.Fab",
	"Edge.Cuts",
] as const;

export type FootprintLayer = (typeof footprintLayers)[number];

export const footprintLayerLabels: Record<FootprintLayer, string> = {
	"F.Cu": "Front copper",
	"B.Cu": "Back copper",
	"F.SilkS": "Front silkscreen",
	"B.SilkS": "Back silkscreen",
	"F.Mask": "Front solder mask",
	"B.Mask": "Back solder mask",
	"F.Paste": "Front paste",
	"B.Paste": "Back paste",
	"F.CrtYd": "Front courtyard",
	"B.CrtYd": "Back courtyard",
	"F.Fab": "Front fabrication",
	"B.Fab": "Back fabrication",
	"Edge.Cuts": "Board outline",
};

export const copperLayers: readonly FootprintLayer[] = ["F.Cu", "B.Cu"];

export const isCopperLayer = (layer: FootprintLayer | undefined) =>
	layer === "F.Cu" || layer === "B.Cu";

const flippedLayers: Partial<Record<FootprintLayer, FootprintLayer>> = {
	"F.Cu": "B.Cu",
	"B.Cu": "F.Cu",
	"F.SilkS": "B.SilkS",
	"B.SilkS": "F.SilkS",
	"F.Mask": "B.Mask",
	"B.Mask": "F.Mask",
	"F.Paste": "B.Paste",
	"B.Paste": "F.Paste",
	"F.CrtYd": "B.CrtYd",
	"B.CrtYd": "F.CrtYd",
	"F.Fab": "B.Fab",
	"B.Fab": "F.Fab",
};

export const flipLayer = (layer: FootprintLayer): FootprintLayer =>
	flippedLayers[layer] ?? layer;

export const padTypes = ["smd", "through-hole"] as const;

export type PadType = (typeof padTypes)[number];

export const padTypeLabels: Record<PadType, string> = {
	smd: "Surface mount",
	"through-hole": "Through-hole",
};
