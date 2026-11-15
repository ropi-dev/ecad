import type { SymbolAttribute } from "#/drawing/shape-kinds.ts";

export const footprintTextVariables = {
	REFERENCE: "reference",
	VALUE: "value",
	FOOTPRINT_NAME: "name",
} as const satisfies Record<string, SymbolAttribute>;

const variablePattern = /\$\{([A-Z_]+)\}/g;

export const showsReference = (text: string) => text.includes(`\${REFERENCE}`);

export function resolveFootprintText(
	text: string,
	attributes: Readonly<Record<SymbolAttribute, string>>,
): string {
	return text.replace(variablePattern, (match, name: string) =>
		Object.hasOwn(footprintTextVariables, name)
			? attributes[
					footprintTextVariables[name as keyof typeof footprintTextVariables]
				]
			: match,
	);
}

const advance = 0.6;
const lineAdvance = 1.25;
const padding = 0.125;

function layoutSize(text: string) {
	const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
	return {
		width:
			Math.max(0.5, ...lines.map((line) => line.length * advance)) +
			padding * 2,
		height: lines.length * lineAdvance + padding * 2,
	};
}

export function resolveFootprintTextShape<
	T extends { text: string; width: number; height: number },
>(shape: T, attributes: Readonly<Record<SymbolAttribute, string>>): T {
	const text = resolveFootprintText(shape.text, attributes);
	if (text === shape.text) return shape;
	const before = layoutSize(shape.text);
	const after = layoutSize(text);
	return {
		...shape,
		text,
		width: (shape.width * after.width) / before.width,
		height: (shape.height * after.height) / before.height,
	};
}

export function unresolveFootprintTextShape<
	T extends { text: string; width: number; height: number },
>(
	shape: T,
	template: { text: string },
	attributes: Readonly<Record<SymbolAttribute, string>>,
): T {
	if (template.text === shape.text) return shape;
	if (resolveFootprintText(template.text, attributes) !== shape.text)
		return shape;
	const before = layoutSize(template.text);
	const after = layoutSize(shape.text);
	return {
		...shape,
		text: template.text,
		width: (shape.width * before.width) / after.width,
		height: (shape.height * before.height) / after.height,
	};
}
