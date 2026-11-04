/** Largest Gerber source the parser accepts, in characters (bytes for ASCII). */
export const MAX_GERBER_SOURCE_LENGTH = 64 * 1024 * 1024;

/** Fixed Gerber layer extensions, lowercase and without the dot. */
export const GERBER_EXTENSIONS: readonly string[] = [
	"gbr",
	"ger",
	"gerber",
	"gbx",
	"pho",
	"art",
	"cmp",
	"sol",
	"plc",
	"stc",
	"sts",
	"gtl",
	"gbl",
	"gts",
	"gbs",
	"gto",
	"gbo",
	"gtp",
	"gbp",
	"gta",
	"gba",
	"gko",
	"gml",
];

/** Numbered mechanical (GM1) and layer (G2, GL2) extensions. */
const NUMBERED_GERBER_EXTENSION = /^(?:gm|gl?)\d+$/;

/** Header commands that identify Gerber RS-274X content. */
const GERBER_SIGNATURE =
	/%(?:FS[LT][AI]X\d\dY\d\d|MO(?:IN|MM)|ADD\d|TF\.FileFunction)/;

/** Lowercase extension of the last path segment, or "" when it has none. */
export function fileExtension(filename: string): string {
	const name = filename.slice(filename.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function hasGerberExtension(filename: string): boolean {
	const extension = fileExtension(filename);
	return (
		GERBER_EXTENSIONS.includes(extension) ||
		NUMBERED_GERBER_EXTENSION.test(extension)
	);
}

export function hasGerberSignature(source: string): boolean {
	return GERBER_SIGNATURE.test(source);
}
