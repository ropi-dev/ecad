import { type UnzipFileInfo, type Unzipped, unzipSync } from "fflate";
import {
	fileExtension,
	hasGerberExtension,
	hasGerberSignature,
	MAX_GERBER_SOURCE_LENGTH,
} from "#/formats/gerber/detect.ts";
import { gerberLayerOrder } from "#/formats/gerber/layer-order.ts";
import { MAX_GERBER_ARCHIVE_BYTES } from "#/formats/import-limits.ts";
import { errorMessage } from "#/lib/error-message.ts";

const MiB = 1024 * 1024;
/** Bytes one archive may extract; each entry is held to the parser limit. */
export const MAX_GERBER_ARCHIVE_LENGTH = MAX_GERBER_ARCHIVE_BYTES;
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
const UNREADABLE = "Unable to read this ZIP archive.";

export type GerberArchive =
	| { files: File[]; messages: string[] }
	| { error: string };

const isHidden = (name: string) =>
	name.endsWith("/") ||
	name.split("/").some((part) => part.startsWith(".") || part === "__MACOSX");

function listNames(names: readonly string[]) {
	const more = names.length - 3;
	return more > 0
		? `${names.slice(0, 3).join(", ")} and ${more} more file${more > 1 ? "s" : ""}`
		: names.join(", ");
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
		skipped.size
			? [
					`Skipped ${[...skipped]
						.map(([reason, names]) => `${listNames(names)} (${reason})`)
						.join("; ")}.`,
				]
			: [];
	return { filter, messages };
}

/** Extracts Gerber layers, bottom of the stack first. Runs in the archive worker. */
export function extractGerberArchive(data: Uint8Array): GerberArchive {
	const selection = selectEntries();
	let contents: Unzipped;
	try {
		// fflate's async unzip would post each large entry to a nested worker as
		// a view of the archive, copying the whole archive once per entry.
		contents = unzipSync(data, { filter: selection.filter });
	} catch {
		return { error: UNREADABLE };
	}
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
		return {
			error: [
				messages.length
					? "This ZIP archive contains no Gerber files within the import limits."
					: "This ZIP archive contains no Gerber files.",
				...messages,
			].join(" "),
		};
	return {
		// The renderer stacks from bottom to top; the layer panel reverses this.
		files: layers
			.sort((a, b) => b.order[0] - a.order[0] || b.order[1] - a.order[1])
			.map(({ file }) => file),
		messages,
	};
}

/** The archive worker's reply, in the shape `requestWorker` expects. */
export async function archiveWorkerReply(file: File) {
	try {
		return {
			result: extractGerberArchive(new Uint8Array(await file.arrayBuffer())),
		};
	} catch (error) {
		return { error: errorMessage(error, UNREADABLE) };
	}
}
