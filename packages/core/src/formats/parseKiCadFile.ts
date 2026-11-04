import { Effect } from "effect";
import { checkFileSize, requestWorker } from "#/formats/import-effects.ts";
import type { KiCadImportResult } from "#/formats/kicad/import.ts";
import { runEffect } from "#/lib/effect.ts";

export function parseKiCadFileEffect(file: File) {
	return Effect.gen(function* () {
		const tooLarge = checkFileSize(file, "kicad");
		if (tooLarge) return yield* tooLarge;
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
