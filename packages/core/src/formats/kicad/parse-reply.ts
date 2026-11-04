import { errorMessage } from "#/lib/error-message.ts";
import { importKiCadSchematic, type KiCadImportResult } from "./import.ts";

/** The KiCad worker's reply, kept free of worker globals so tests can run it inline. */
export async function kicadWorkerReply(
	file: Blob,
): Promise<{ result: KiCadImportResult } | { error: string }> {
	try {
		return { result: importKiCadSchematic(await file.text()) };
	} catch (error) {
		return { error: errorMessage(error, "Unable to import this schematic.") };
	}
}
