export interface OverbarText {
	readonly text: string;
	readonly overbars: readonly (readonly [start: number, end: number])[];
}

function closingBrace(source: string, from: number): number {
	let depth = 1;
	for (let index = from; index < source.length; index++) {
		if (source[index] === "{") depth += 1;
		else if (source[index] === "}" && --depth === 0) return index;
	}
	return -1;
}

export function parseOverbars(source: string): OverbarText {
	if (!source.includes("~{")) return { text: source, overbars: [] };
	let text = "";
	const overbars: [number, number][] = [];
	let index = 0;
	while (index < source.length) {
		const end = source.startsWith("~{", index)
			? closingBrace(source, index + 2)
			: -1;
		if (end === -1) {
			text += source[index];
			index += 1;
			continue;
		}
		const start = text.length;
		text += source.slice(index + 2, end);
		if (text.length > start) overbars.push([start, text.length]);
		index = end + 1;
	}
	return { text, overbars };
}

const balanced = (text: string) => {
	let depth = 0;
	for (const character of text) {
		if (character === "{") depth += 1;
		else if (character === "}" && --depth < 0) return false;
	}
	return depth === 0;
};

export const overbarText = (text: string) =>
	text &&
	!text.includes("\n") &&
	balanced(text) &&
	!parseOverbars(text).overbars.length
		? `~{${text}}`
		: text;
