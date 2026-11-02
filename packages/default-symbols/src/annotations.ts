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
						x: 10,
						y: -6,
						width: 20,
						height: 12,
						lineWidth: 0.3,
						locked: false,
					},
					{
						kind: "text",
						text: "Text",
						x: 1,
						y: -1,
						width: 4.6,
						height: 3,
						fontSize: 2,
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
