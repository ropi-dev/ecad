import { Effect } from "effect";
import { runEffect } from "#/lib/effect.ts";
import { InvalidFile, requestWorker } from "./import-effects";
import type { KiCadImportResult } from "./kicad/import.ts";

const MiB = 1024 * 1024;

/**
 * Checked before the file is read. The 535 KB RP2350A fixture, with 87
 * components and their embedded symbols, is about 1.6% of this limit, so it
 * leaves room for sheets far larger than usual. Parsing holds the text and its
 * whole expression tree in memory, so larger files would cost hundreds of
 * megabytes in the worker.
 */
export const MAX_KICAD_FILE_BYTES = 32 * MiB;

export function parseKiCadFileEffect(file: File) {
	return Effect.gen(function* () {
		if (file.size > MAX_KICAD_FILE_BYTES)
			return yield* new InvalidFile({
				message: `KiCad schematics must be ${MAX_KICAD_FILE_BYTES / MiB} MiB or smaller.`,
			});
		return yield* requestWorker<KiCadImportResult>({
			create: () =>
				new Worker(new URL("./kicad/parse.worker.ts", import.meta.url), {
					type: "module",
				}),
			message: { file },
			timeout: 60_000,
			timeoutMessage: "KiCad import timed out. Try a smaller schematic.",
			parseMessage: "Unable to import this schematic.",
			startMessage: "Unable to start the KiCad importer.",
			receiveMessage: "Unable to receive the imported schematic.",
		});
	});
}

/** Parses and converts a `.kicad_sch` file in a worker. */
export function parseKiCadFile(
	file: File,
	signal?: AbortSignal,
): Promise<KiCadImportResult> {
	return runEffect(parseKiCadFileEffect(file), signal);
}
