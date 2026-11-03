import { Effect } from "effect";
import { type UnzipFileInfo, type Unzipped, unzip } from "fflate";
import {
	fileExtension,
	hasGerberExtension,
	hasGerberSignature,
	MAX_GERBER_SOURCE_LENGTH,
} from "#/formats/gerber/detect.ts";
import { gerberLayerOrder } from "#/formats/gerber/layer-order.ts";
import { runEffect } from "#/lib/effect.ts";
import { ArchiveError, readFile } from "./import-effects";

const MiB = 1024 * 1024;
/** Bytes one archive may extract; each entry is held to the parser limit. */
export const MAX_GERBER_ARCHIVE_LENGTH = 4 * MAX_GERBER_SOURCE_LENGTH;
/** Format signatures and X2 file attributes appear in the file header. */
const HEADER_LENGTH = 8 * 1024;
/** Files that fabrication archives bundle beside Gerber layers. */
const NON_GERBER_EXTENSIONS = new Set([
	...["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp", "svg", "ico"],
	...["pdf", "doc", "docx", "xls", "xlsx", "ods", "odt", "rtf", "csv"],
	...["htm", "html", "md", "json", "xml"],
	...["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"],
	...["step", "stp", "wrl", "igs", "iges", "stl", "3mf", "obj", "dxf", "dwg"],
	...["kicad_pcb", "kicad_sch", "kicad_pro", "kicad_prl", "brd", "sch"],
	...["pcbdoc", "schdoc", "prjpcb", "gbrjob", "drl", "xln", "exc", "ipc"],
	...["d356", "pos", "exe", "dll", "so", "dylib"],
]);
/** Deflate (8) and stored (0) entries; fflate rejects other methods. */
const SUPPORTED_COMPRESSION = new Set([0, 8]);

const isHidden = (name: string) =>
	name.endsWith("/") ||
	name.split("/").some((part) => part.startsWith(".") || part === "__MACOSX");

function skippedMessage(reason: string, names: readonly string[]) {
	const shown = names.slice(0, 3).join(", ");
	const more =
		names.length > 3
			? ` and ${names.length - 3} more file${names.length > 4 ? "s" : ""}`
			: "";
	return `Skipped ${shown}${more} (${reason}).`;
}

/**
 * Chooses archive entries from their names and central-directory sizes, so
 * oversized entries are never inflated and non-Gerber formats are never read.
 */
function selectEntries() {
	let extracted = 0;
	const skipped = new Map<string, string[]>();
	const skip = (name: string, reason: string) => {
		const names = skipped.get(reason);
		if (names) names.push(name);
		else skipped.set(reason, [name]);
		return false;
	};
	const filter = ({ name, size, originalSize, compression }: UnzipFileInfo) => {
		if (isHidden(name) || NON_GERBER_EXTENSIONS.has(fileExtension(name)))
			return false;
		if (!SUPPORTED_COMPRESSION.has(compression))
			return skip(name, "unsupported ZIP compression method");
		// Stored entries copy their compressed bytes; deflated entries fill a buffer of the declared size.
		const length = Math.max(size, originalSize);
		if (length > MAX_GERBER_SOURCE_LENGTH)
			return skip(
				name,
				`larger than the ${MAX_GERBER_SOURCE_LENGTH / MiB} MiB Gerber file limit`,
			);
		if (extracted + length > MAX_GERBER_ARCHIVE_LENGTH)
			return skip(
				name,
				`over the ${MAX_GERBER_ARCHIVE_LENGTH / MiB} MiB limit for one ZIP archive`,
			);
		extracted += length;
		return true;
	};
	const messages = () =>
		[...skipped].map(([reason, names]) => skippedMessage(reason, names));
	return { filter, messages };
}

function unzipEffect(
	data: Uint8Array,
	filter: (entry: UnzipFileInfo) => boolean,
) {
	return Effect.async<Unzipped, ArchiveError>((resume) => {
		try {
			const terminate = unzip(data, { filter }, (cause, result) => {
				resume(
					cause
						? Effect.fail(
								new ArchiveError({
									message: "Unable to read this ZIP archive.",
									cause,
								}),
							)
						: Effect.succeed(result),
				);
			});
			return Effect.sync(terminate);
		} catch (cause) {
			resume(
				Effect.fail(
					new ArchiveError({
						message: "Unable to read this ZIP archive.",
						cause,
					}),
				),
			);
		}
	});
}

export function expandGerberFileEffect(file: File) {
	return Effect.gen(function* () {
		if (!/\.zip$/i.test(file.name)) return { files: [file], messages: [] };
		const buffer = yield* readFile(() => file.arrayBuffer());
		const selection = selectEntries();
		const contents = yield* unzipEffect(
			new Uint8Array(buffer),
			selection.filter,
		);
		const decoder = new TextDecoder();
		const layers: { file: File; order: ReturnType<typeof gerberLayerOrder> }[] =
			[];
		for (const name of Object.keys(contents)) {
			const bytes = contents[name] as Uint8Array<ArrayBuffer>;
			delete contents[name];
			const header = decoder.decode(bytes.subarray(0, HEADER_LENGTH));
			// Only entries without a Gerber extension need their content sniffed.
			if (
				!hasGerberExtension(name) &&
				(header.includes("\0") || !hasGerberSignature(header))
			)
				continue;
			layers.push({
				file: new File([bytes], name, { type: "text/plain" }),
				order: gerberLayerOrder(name, header),
			});
		}
		const messages = selection.messages();
		if (!layers.length)
			return yield* new ArchiveError({
				message: [
					messages.length
						? "This ZIP archive contains no Gerber files within the import limits."
						: "This ZIP archive contains no Gerber files.",
					...messages,
				].join(" "),
			});
		return {
			// The renderer stacks from bottom to top; the layer panel reverses this.
			files: layers
				.sort((a, b) => b.order[0] - a.order[0] || b.order[1] - a.order[1])
				.map(({ file }) => file),
			messages,
		};
	});
}

export function expandGerberFile(file: File, signal: AbortSignal) {
	return runEffect(expandGerberFileEffect(file), signal);
}
