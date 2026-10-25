/** Portable version 1 geometry. This package has no editor or renderer dependencies. */
export type SymbolPrimitive =
	| { kind: "line" | "wire"; x1: number; y1: number; x2: number; y2: number }
	| {
			kind: "rectangle";
			x: number;
			y: number;
			width: number;
			height: number;
			rotation?: number;
			locked?: boolean;
	  }
	| {
			kind: "text";
			text: string;
			x: number;
			y: number;
			width: number;
			height: number;
			fontSize: number;
			horizontalAlign?: "left" | "center" | "right";
			verticalAlign?: "top" | "middle" | "bottom";
	  }
	| { kind: "circle"; x: number; y: number; radius: number }
	| { kind: "pin"; x: number; y: number; name: string; showLabels?: boolean };

export interface DefaultSymbolFile {
	format: "ecad-symbol";
	version: 1;
	units: "mm";
	id: string;
	name: string;
	description: string;
	prefix: string;
	value: string;
	shapes: SymbolPrimitive[];
}

export const symbolCategories = [
	"Passives",
	"Diodes",
	"Transistors",
	"Switches",
	"Power",
	"Connectors",
	"Amplifiers",
	"Other components",
	"Annotations",
] as const;

export type SymbolCategory = (typeof symbolCategories)[number];

export interface DefaultSymbol {
	category: SymbolCategory;
	file: DefaultSymbolFile;
	/** Labels belong to editor instances. Version 1 portable files do not store them. */
	texts: {
		attribute: "reference" | "value";
		x: number;
		y: number;
		fontSize: number;
	}[];
}

export type SourceShape =
	| readonly ["polyline", ...points: readonly [number, number][]]
	| readonly ["rectangle", x1: number, y1: number, x2: number, y2: number]
	| readonly ["circle", x: number, y: number, radius: number]
	| readonly [
			"arc",
			x: number,
			y: number,
			radius: number,
			start: number,
			sweep: number,
	  ]
	| readonly [
			"pin",
			name: string,
			x: number,
			y: number,
			length: number,
			direction: "U" | "D" | "L" | "R",
	  ];

export interface SourceSymbol {
	id: string;
	category: SymbolCategory;
	name: string;
	description: string;
	prefix: string;
	value: string;
	source: string;
	rotation: number;
	showPinLabels?: boolean;
	drawing: readonly SourceShape[];
}
