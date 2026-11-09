import { drawingFontFamily } from "#/drawing/text.ts";

/** JetBrains Mono subsets under the SIL Open Font License; see fonts/OFL.txt. */
const subsets = [
	{
		unicodeRange:
			"U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
		urls: {
			400: new URL(
				"./fonts/jetbrains-mono-latin-400-normal.woff2",
				import.meta.url,
			),
			700: new URL(
				"./fonts/jetbrains-mono-latin-700-normal.woff2",
				import.meta.url,
			),
		},
	},
	{
		unicodeRange:
			"U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
		urls: {
			400: new URL(
				"./fonts/jetbrains-mono-latin-ext-400-normal.woff2",
				import.meta.url,
			),
			700: new URL(
				"./fonts/jetbrains-mono-latin-ext-700-normal.woff2",
				import.meta.url,
			),
		},
	},
	{
		// Ω and other Greek letters are common in component values.
		unicodeRange:
			"U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF",
		urls: {
			400: new URL(
				"./fonts/jetbrains-mono-greek-400-normal.woff2",
				import.meta.url,
			),
			700: new URL(
				"./fonts/jetbrains-mono-greek-700-normal.woff2",
				import.meta.url,
			),
		},
	},
] as const;

let loading: Promise<void> | undefined;
let loaded = false;

export const drawingFontsLoaded = () =>
	typeof document === "undefined" || typeof FontFace === "undefined" || loaded;

/**
 * Loads every subset before the editor measures or paints text. Canvas text
 * does not wait for web fonts, so text drawn earlier would use the fallback.
 * A failed load resolves too, and drawing continues with the fallback font.
 */
export function loadDrawingFonts(): Promise<void> {
	if (drawingFontsLoaded()) return Promise.resolve();
	loading ??= Promise.all(
		subsets.flatMap(({ unicodeRange, urls }) =>
			Object.entries(urls).map(([weight, url]) => {
				const face = new FontFace(drawingFontFamily, `url(${url.href})`, {
					weight,
					unicodeRange,
					display: "block",
				});
				document.fonts.add(face);
				return face.load();
			}),
		),
	).then(
		() => {
			loaded = true;
		},
		(error: unknown) => {
			loaded = true;
			console.warn("The schematic font could not be loaded.", error);
		},
	);
	return loading;
}
