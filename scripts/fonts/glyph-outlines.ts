import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";

const fonts = new URL(
	"../../packages/core/src/engine/drawing/fonts/",
	import.meta.url,
);
const subsets = ["latin", "latin-ext", "greek"] as const;
const weights = ["400", "700"] as const;
const defaultAdvance = 600;

const number = (value: number) => {
	const rounded = Math.round(value * 2) / 2;
	if (Math.abs(rounded - value) > 1e-6)
		throw new Error(`Unexpected glyph coordinate ${value}`);
	return String(rounded);
};

function relativePath(commands: fontkit.Glyph["path"]["commands"]): string {
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	const parts: string[] = [];
	const offset = (toX: number, toY: number) =>
		`${number(toX - x)} ${number(toY - y)}`;
	const point = (toX: number, toY: number) => {
		const value = offset(toX, toY);
		x = toX;
		y = toY;
		return value;
	};
	for (const { command, args } of commands) {
		if (command === "moveTo") {
			parts.push(`m${point(args[0], args[1])}`);
			startX = x;
			startY = y;
		} else if (command === "lineTo") parts.push(`l${point(args[0], args[1])}`);
		else if (command === "quadraticCurveTo")
			parts.push(`q${offset(args[0], args[1])} ${point(args[2], args[3])}`);
		else if (command === "closePath") {
			parts.push("z");
			x = startX;
			y = startY;
		} else throw new Error(`Unexpected glyph command ${command}`);
	}
	return parts.join("").replace(/ -/g, "-");
}

function weightOutlines(weight: (typeof weights)[number]) {
	const glyphs: Record<string, string> = {};
	const advances: Record<string, number> = {};
	for (const subset of subsets) {
		const font = fontkit.openSync(
			fileURLToPath(
				new URL(`jetbrains-mono-${subset}-${weight}-normal.woff2`, fonts),
			),
		);
		if (!("characterSet" in font)) throw new Error("Expected a single font");
		if (font.unitsPerEm !== 1000) throw new Error("Expected 1000 units per em");
		for (const codePoint of font.characterSet) {
			const glyph = font.glyphForCodePoint(codePoint);
			const path = relativePath(glyph.path.commands);
			if (path) glyphs[codePoint] = path;
			if (glyph.advanceWidth !== defaultAdvance)
				advances[codePoint] = glyph.advanceWidth;
		}
	}
	return { glyphs, advances };
}

export const glyphOutlinesFile = fileURLToPath(
	new URL("jetbrains-mono-outlines.json", fonts),
);

export const glyphOutlines = () => ({
	unitsPerEm: 1000,
	advance: defaultAdvance,
	weights: Object.fromEntries(
		weights.map((weight) => [weight, weightOutlines(weight)]),
	),
});

if (import.meta.main)
	writeFileSync(
		glyphOutlinesFile,
		`${JSON.stringify(glyphOutlines(), null, "\t")}\n`,
	);
