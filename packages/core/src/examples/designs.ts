import type { BoardRules } from "@ecad/drawing-core/board/rules.ts";
import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";

/** A finished design: its schematic, the circuit it describes and its board. */
export interface ExampleDesign {
	name: string;
	/** Saved drawing shapes: library symbols leave out their geometry. */
	schematic: unknown[];
	circuit: Circuit;
	rules: BoardRules;
	board: EditorShape[];
}

export const exampleDesigns = {
	rp2350a: {
		label: "RP2350A reference design",
		load: async (): Promise<ExampleDesign> =>
			(await import("#/examples/rp2350a-design.json")).default as ExampleDesign,
	},
} as const;

export type ExampleDesignId = keyof typeof exampleDesigns;
