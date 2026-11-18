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

export const innerCopperLayers = [
	"In1.Cu",
	"In2.Cu",
	"In3.Cu",
	"In4.Cu",
	"In5.Cu",
	"In6.Cu",
	"In7.Cu",
	"In8.Cu",
	"In9.Cu",
	"In10.Cu",
	"In11.Cu",
	"In12.Cu",
	"In13.Cu",
	"In14.Cu",
	"In15.Cu",
	"In16.Cu",
	"In17.Cu",
	"In18.Cu",
	"In19.Cu",
	"In20.Cu",
	"In21.Cu",
	"In22.Cu",
	"In23.Cu",
	"In24.Cu",
	"In25.Cu",
	"In26.Cu",
	"In27.Cu",
	"In28.Cu",
	"In29.Cu",
	"In30.Cu",
] as const;

export type InnerCopperLayer = (typeof innerCopperLayers)[number];

export const allLayers = [...footprintLayers, ...innerCopperLayers] as const;

export type FootprintLayer = (typeof allLayers)[number];

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
	...(Object.fromEntries(
		innerCopperLayers.map((layer, index) => [
			layer,
			`Inner copper ${index + 1}`,
		]),
	) as Record<InnerCopperLayer, string>),
};

export type OuterCopperLayer = "F.Cu" | "B.Cu";

export type CopperLayer = OuterCopperLayer | InnerCopperLayer;

export const outerCopperLayers: readonly OuterCopperLayer[] = ["F.Cu", "B.Cu"];

export const copperLayers: readonly CopperLayer[] = [
	"F.Cu",
	...innerCopperLayers,
	"B.Cu",
];

const innerLayerSet: ReadonlySet<string> = new Set(innerCopperLayers);

export const isInnerCopperLayer = (
	layer: FootprintLayer | undefined,
): layer is InnerCopperLayer => layer !== undefined && innerLayerSet.has(layer);

export const isOuterCopperLayer = (
	layer: FootprintLayer | undefined,
): layer is OuterCopperLayer => layer === "F.Cu" || layer === "B.Cu";

export const isCopperLayer = (
	layer: FootprintLayer | undefined,
): layer is CopperLayer =>
	isOuterCopperLayer(layer) || isInnerCopperLayer(layer);

export const maxCopperLayers = copperLayers.length;

export const copperLayerCounts: readonly number[] = Array.from(
	{ length: maxCopperLayers / 2 },
	(_, index) => 2 * (index + 1),
);

const stacks = new Map<number, readonly CopperLayer[]>();

/** @return The copper layers of a board with `count` of them, front first. */
export function boardCopperLayers(count: number): readonly CopperLayer[] {
	let stack = stacks.get(count);
	if (!stack) {
		stack = [
			"F.Cu",
			...innerCopperLayers.slice(0, Math.max(0, count - 2)),
			"B.Cu",
		];
		stacks.set(count, stack);
	}
	return stack;
}

const layerLists = new Map<number, readonly FootprintLayer[]>();

/** @return The layers of a board with `count` copper layers, as the Layers panel lists them. */
export function boardLayers(count: number): readonly FootprintLayer[] {
	let layers = layerLists.get(count);
	if (!layers) {
		layers = [
			...boardCopperLayers(count),
			...footprintLayers.filter((layer) => !isCopperLayer(layer)),
		];
		layerLists.set(count, layers);
	}
	return layers;
}

/** @return The fewest copper layers that keep every inner layer in `layers`. */
export function fewestCopperLayers(
	layers: Iterable<FootprintLayer | undefined>,
): number {
	let deepest = 0;
	for (const layer of layers)
		if (isInnerCopperLayer(layer))
			deepest = Math.max(deepest, innerCopperLayers.indexOf(layer) + 1);
	return 2 + deepest + (deepest % 2);
}

/** @return The Gerber X2 file function of a copper layer on a board with `count` copper layers. */
export function copperLayerFunction(layer: CopperLayer, count: number): string {
	if (layer === "F.Cu") return "Copper,L1,Top";
	if (layer === "B.Cu") return `Copper,L${count},Bot`;
	return `Copper,L${innerCopperLayers.indexOf(layer) + 2},Inr`;
}

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
