import { Effect } from "effect";
import type { GerberArchive } from "#/formats/gerber/archive.ts";
import { runEffect } from "#/lib/effect.ts";
import { ArchiveError, requestWorker } from "./import-effects";

const UNREADABLE = "Unable to read this ZIP archive.";

/**
 * Extracts ZIP archives in a worker, so inflating never blocks the page and
 * aborting the import or the timeout stops it. The worker receives the File
 * by reference and reads the archive itself.
 */
export function expandGerberFileEffect(file: File) {
	return Effect.gen(function* () {
		if (!/\.zip$/i.test(file.name)) return { files: [file], messages: [] };
		const archive = yield* requestWorker<GerberArchive>({
			create: () =>
				new Worker(new URL("./gerber/archive.worker.ts", import.meta.url), {
					type: "module",
				}),
			message: { file },
			timeout: 60_000,
			timeoutMessage: "Extracting this ZIP archive timed out.",
			parseMessage: UNREADABLE,
			startMessage: UNREADABLE,
			receiveMessage: UNREADABLE,
		});
		if ("error" in archive)
			return yield* new ArchiveError({ message: archive.error });
		return archive;
	});
}

export function expandGerberFile(file: File, signal: AbortSignal) {
	return runEffect(expandGerberFileEffect(file), signal);
}
