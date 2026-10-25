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
						locked: false,
					},
					{
						kind: "text",
						text: "Text",
						x: 1,
						y: -1,
						width: 16,
						height: 8,
						fontSize: 1.3,
						horizontalAlign: "left",
						verticalAlign: "top",
					},
				],
			},
			texts: [],
		},
	];
}
