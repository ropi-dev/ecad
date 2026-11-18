import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { strToU8, zipSync } from "fflate";
import type { ZoneFill } from "#/board/fill.ts";
import { exportFabrication } from "#/board/gerber.ts";

export interface FabricationArchive {
	archive: Uint8Array<ArrayBuffer>;
	files: number;
}

export function fabricationArchive(
	name: string,
	shapes: readonly EditorShape[],
	fills: readonly Pick<ZoneFill, "layer" | "polygons">[],
	maskMargin: number,
	copperLayers = 2,
): FabricationArchive {
	const files = exportFabrication(
		name,
		shapes,
		fills,
		maskMargin,
		copperLayers,
	);
	return {
		archive: zipSync(
			Object.fromEntries(
				files.map((file) => [file.name, strToU8(file.content)]),
			),
		),
		files: files.length,
	};
}
