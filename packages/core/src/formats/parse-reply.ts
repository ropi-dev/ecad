import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	compilePlanarGeometry,
	type PlanarGeometry,
} from "#/engine/planar-geometry.ts";
import { buildPlanarWalls, type PlanarWalls } from "#/engine/planar-walls.ts";
import type { ParseResult } from "#/engine/types.ts";
import { DRILL_WALL, isDrillLayer } from "#/formats/gerber/board-stack.ts";
import { parsers } from "#/formats/registry.ts";

export interface ParseWorkerResult extends ParseResult {
	mesh?: PlanarGeometry;
	walls?: PlanarWalls;
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
		const walls =
			mesh &&
			buildPlanarWalls(
				mesh.edges,
				isDrillLayer(result.object) ? "barrel" : "slab",
				DRILL_WALL,
			);
		return { result: { ...result, mesh, walls } };
	} catch (error) {
		return { error: errorMessage(error, "Unable to parse this file.") };
	}
}
