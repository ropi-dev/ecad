import {
	compilePlanarGeometry,
	type PlanarGeometry,
} from "#/engine/planar-geometry.ts";
import type { ParseResult } from "#/engine/types.ts";
import { errorMessage } from "#/lib/error-message.ts";
import { parsers } from "./registry";

export interface ParseWorkerResult extends ParseResult {
	mesh?: PlanarGeometry;
}

/** The parse worker's reply, kept free of worker globals so tests can run it inline. */
export function parseWorkerReply(
	source: string,
	filename: string,
): { result: ParseWorkerResult } | { error: string } {
	try {
		const result = parsers.parse(source, filename);
		// Errors skip single commands, so the rest of the geometry still renders.
		const mesh = result.diagnostics.some((entry) => entry.severity === "fatal")
			? undefined
			: compilePlanarGeometry(result.object.objects);
		return { result: { ...result, mesh } };
	} catch (error) {
		return { error: errorMessage(error, "Unable to parse this file.") };
	}
}
