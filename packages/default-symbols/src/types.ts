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
			filled?: boolean;
			lineWidth?: number;
	  }
	| {
			kind: "text";
			text: string;
			x: number;
			y: number;
			width: number;
			height: number;
			fontSize: number;
			bold?: boolean;
			horizontalAlign?: "left" | "center" | "right";
			verticalAlign?: "top" | "middle" | "bottom";
	  }
	| { kind: "circle"; x: number; y: number; radius: number }
	| {
			kind: "pin";
			x: number;
			y: number;
			name: string;
			number?: string;
			length?: number;
			rotation?: number;
			labelOffset?: number;
			showLabels?: boolean;
			showName?: boolean;
			showNumber?: boolean;
	  };

export interface DefaultSymbolFile {
	format: "ecad-symbol";
	version: 1;
	units: "mm";
	id: string;
	name: string;
	description: string;
	prefix: string;
	value: string;
	netSymbol?: boolean;
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
	"Microcontrollers",
	"Other components",
	"Annotations",
] as const;

export type SymbolCategory = (typeof symbolCategories)[number];

export interface SymbolPackaging {
	part: string;
	name: string;
	description: string;
}

export interface DefaultSymbol {
	category: SymbolCategory;
	packaging?: SymbolPackaging;
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
			number?: string,
	  ];

export interface SourceSymbol {
	id: string;
	category: SymbolCategory;
	packaging?: SymbolPackaging;
	name: string;
	description: string;
	prefix: string;
	value: string;
	netSymbol?: boolean;
	source: string;
	rotation: number;
	filled?: boolean;
	showPinLabels?: boolean;
	drawing: readonly SourceShape[];
}
