import {
	DEFAULT_STROKE_WIDTH,
	DEFAULT_TEXT_SIZE,
	fromMils,
} from "@ecad/drawing-core/drawing/units.ts";
import type { DefaultSymbol } from "./types.ts";

export function annotationSymbols(): DefaultSymbol[] {
	return [
		{
			category: "Annotations",
			file: {
				format: "ecad-symbol",
				version: 1,
				units: "mm",
				id: "box",
				name: "Box",
				description: "Resizable rectangle with editable text",
				prefix: "BOX",
				value: "",
				shapes: [
					{
						kind: "rectangle",
						x: fromMils(500),
						y: fromMils(-300),
						width: fromMils(1000),
						height: fromMils(600),
						lineWidth: DEFAULT_STROKE_WIDTH,
						locked: false,
					},
					{
						kind: "text",
						text: "Text",
						x: fromMils(50),
						y: fromMils(-50),
						width: fromMils(230),
						height: fromMils(150),
						fontSize: DEFAULT_TEXT_SIZE,
						bold: true,
						horizontalAlign: "left",
						verticalAlign: "top",
					},
				],
			},
			texts: [],
		},
	];
}
