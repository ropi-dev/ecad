import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { FootprintLayer } from "@ecad/drawing-core/footprint/layers.ts";

type Point = readonly [x: number, y: number];
type PadShape = "rect" | "circle";

export type SourceItem =
	| readonly [
			"smd",
			number: string,
			shape: PadShape,
			x: number,
			y: number,
			width: number,
			height: number,
			angle: number,
			paste: boolean,
	  ]
	| readonly [
			"tht",
			number: string,
			shape: PadShape,
			x: number,
			y: number,
			width: number,
			height: number,
			angle: number,
			drill: number,
	  ]
	/** A paste opening drawn on its own, such as the windows over an exposed pad. */
	| readonly [
			"paste",
			x: number,
			y: number,
			width: number,
			height: number,
			angle: number,
	  ]
	| readonly [
			"line",
			layer: FootprintLayer,
			x1: number,
			y1: number,
			x2: number,
			y2: number,
			width: number,
	  ]
	| readonly [
			"rect",
			layer: FootprintLayer,
			x1: number,
			y1: number,
			x2: number,
			y2: number,
			width: number,
			filled: boolean,
	  ]
	| readonly [
			"circle",
			layer: FootprintLayer,
			x: number,
			y: number,
			radius: number,
			width: number,
			filled: boolean,
	  ]
	| readonly [
			"arc",
			layer: FootprintLayer,
			startX: number,
			startY: number,
			midX: number,
			midY: number,
			endX: number,
			endY: number,
			width: number,
	  ]
	| readonly [
			"poly",
			layer: FootprintLayer,
			width: number,
			filled: boolean,
			...points: Point[],
	  ];

export interface SourceFootprint {
	id: string;
	/** The KiCad library the footprint comes from, such as Resistor_SMD. */
	category: string;
	name: string;
	description: string;
	items: readonly SourceItem[];
}

export interface DefaultFootprintFile {
	format: "ecad-footprint";
	version: 1;
	units: "mm";
	id: string;
	name: string;
	description: string;
	shapes: EditorShape[];
}

export interface DefaultFootprint {
	category: string;
	file: DefaultFootprintFile;
}
