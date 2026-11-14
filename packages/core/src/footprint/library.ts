import type { DefaultFootprint } from "@ecad/default-footprints";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { isPad } from "@ecad/drawing-core/footprint/shapes.ts";
import { useEffect, useState } from "react";
import { measurePerformance } from "#/performance/runtime.ts";

export interface BuiltinFootprintLibrary {
	readonly footprints: readonly DefaultFootprint[];
	readonly byId: ReadonlyMap<string, DefaultFootprint>;
	/** KiCad library names in catalog order. */
	readonly categories: readonly string[];
}

let loading: Promise<BuiltinFootprintLibrary> | undefined;
let loaded: BuiltinFootprintLibrary | undefined;

export function loadBuiltinFootprints(): Promise<BuiltinFootprintLibrary> {
	loading ??= import("@ecad/default-footprints").then(
		({ generateDefaultFootprints }) => {
			const footprints = measurePerformance(
				"footprint-library.generate",
				generateDefaultFootprints,
			);
			loaded = {
				footprints,
				byId: new Map(
					footprints.map((footprint) => [footprint.file.id, footprint]),
				),
				categories: [...new Set(footprints.map(({ category }) => category))],
			};
			return loaded;
		},
		(cause: unknown) => {
			loading = undefined;
			throw cause;
		},
	);
	return loading;
}

export interface BuiltinFootprints {
	readonly library: BuiltinFootprintLibrary | undefined;
	readonly failed: boolean;
}

export function useBuiltinFootprints(): BuiltinFootprints {
	const [library, setLibrary] = useState(loaded);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (library) return;
		let current = true;
		loadBuiltinFootprints().then(
			(next) => {
				if (current) setLibrary(next);
			},
			() => {
				if (current) setFailed(true);
			},
		);
		return () => {
			current = false;
		};
	}, [library]);
	return { library, failed };
}

export const footprintPadNumbers = (shapes: readonly EditorShape[]) =>
	shapes.flatMap((shape) => (isPad(shape) ? [shape.pad.number] : []));
