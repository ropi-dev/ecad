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
};

export const copperLayers: readonly FootprintLayer[] = ["F.Cu", "B.Cu"];

export const padTypes = ["smd", "through-hole"] as const;

export type PadType = (typeof padTypes)[number];

export const padTypeLabels: Record<PadType, string> = {
	smd: "Surface mount",
	"through-hole": "Through-hole",
};
