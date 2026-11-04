import { MAX_GERBER_SOURCE_LENGTH } from "#/formats/gerber/detect.ts";

const MiB = 1024 * 1024;

/**
 * Checked before the file is read. Component models are usually a few MiB
 * and whole-board assemblies tens of MiB. The importer copies the file into
 * WebAssembly memory and tessellates it there, so files beyond this size are
 * likely to exhaust that memory or the import timeout anyway.
 */
export const MAX_STEP_FILE_BYTES = 256 * MiB;

/**
 * Checked before the file is read. Gerber is ASCII, so this matches the
 * parser's character limit, which still applies to the decoded text. ZIP
 * extraction skips entries over the same size.
 */
export const MAX_GERBER_FILE_BYTES = MAX_GERBER_SOURCE_LENGTH;

/**
 * Checked before a Gerber ZIP archive is read. It equals the most one archive
 * may extract (`MAX_GERBER_ARCHIVE_LENGTH`, four files at the per-file limit).
 * Stored entries occupy as many bytes in the archive as they extract to, so a
 * larger archive could stay within the extraction limit only if most of it
 * were skipped files.
 */
export const MAX_GERBER_ARCHIVE_BYTES = 4 * MAX_GERBER_SOURCE_LENGTH;

/**
 * Checked before the file is read. The 535 KB RP2350A fixture, with 87
 * components and their embedded symbols, is about 1.6% of this limit, so it
 * leaves room for sheets far larger than usual. Parsing holds the text and its
 * whole expression tree in memory, so larger files would cost hundreds of
 * megabytes in the worker.
 */
export const MAX_KICAD_FILE_BYTES = 32 * MiB;

export type ImportFormat = "step" | "gerber" | "gerber-archive" | "kicad";

const limits: Record<ImportFormat, { bytes: number; files: string }> = {
	step: { bytes: MAX_STEP_FILE_BYTES, files: "STEP files" },
	gerber: { bytes: MAX_GERBER_FILE_BYTES, files: "Gerber files" },
	"gerber-archive": {
		bytes: MAX_GERBER_ARCHIVE_BYTES,
		files: "Gerber ZIP archives",
	},
	kicad: { bytes: MAX_KICAD_FILE_BYTES, files: "KiCad schematics" },
};

/** The format whose limit applies to a stored project asset. */
export function assetFormat(name: string, kind: "gerber" | "step") {
	if (kind === "step") return "step";
	return /\.zip$/i.test(name) ? "gerber-archive" : "gerber";
}

/** The reason a file of `size` bytes is too large to import, if it is. */
export function fileSizeProblem(format: ImportFormat, size: number) {
	const { bytes, files } = limits[format];
	return size > bytes
		? `${files} must be ${bytes / MiB} MiB or smaller.`
		: undefined;
}
