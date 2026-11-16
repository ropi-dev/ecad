import { useEffect, useMemo, useState } from "react";
import type { Object3D } from "three";
import {
	type BuiltinModelLibrary,
	loadBuiltinModels,
	type ModelPlacement,
} from "#/footprint/models.ts";
import {
	measurePerformance,
	measurePerformanceAsync,
} from "#/performance/runtime.ts";

type ModelEngine = typeof import("#/engine/footprint-models.ts");

const placementKey = (placements: readonly ModelPlacement[]) =>
	placements
		.map(
			({ model, x, y, rotation, flipped }) =>
				`${model.library}:${model.id}@${x},${y},${rotation},${flipped}`,
		)
		.join(";");

export function useFootprintModels(
	placements: readonly ModelPlacement[],
	enabled: boolean,
	onError?: (message: string) => void,
): Object3D | undefined {
	const [engine, setEngine] = useState<ModelEngine>();
	const [library, setLibrary] = useState<BuiltinModelLibrary>();
	const [templates, setTemplates] = useState<ReadonlyMap<string, Object3D>>(
		() => new Map(),
	);
	useEffect(() => {
		if (!enabled || (engine && library)) return;
		let current = true;
		Promise.all([
			import("#/engine/footprint-models.ts"),
			loadBuiltinModels(),
		]).then(
			([loadedEngine, loadedLibrary]) => {
				if (!current) return;
				setEngine(loadedEngine);
				setLibrary(loadedLibrary);
			},
			() => {
				if (current) onError?.("Unable to load the 3D model library.");
			},
		);
		return () => {
			current = false;
		};
	}, [enabled, engine, library, onError]);
	const ids = enabled
		? [...new Set(placements.map(({ model }) => model.id))].sort().join("\n")
		: "";
	// biome-ignore lint/correctness/useExhaustiveDependencies: ids names the models to load; templates only grows, so a loaded model is never fetched twice
	useEffect(() => {
		if (!engine || !library || !ids) return;
		let current = true;
		for (const id of ids.split("\n")) {
			const model = library.byId.get(id);
			if (!model || templates.has(id)) continue;
			measurePerformanceAsync("footprint.model-load", () =>
				engine.loadModelTemplate(model.url),
			).then(
				(template) => {
					if (current)
						setTemplates((loaded) => new Map(loaded).set(id, template));
				},
				() => {
					if (current) onError?.(`Unable to load the 3D model ${model.name}.`);
				},
			);
		}
		return () => {
			current = false;
		};
	}, [engine, library, ids, onError]);
	const placer = useMemo(() => engine?.createModelPlacer(), [engine]);
	const key = placementKey(placements);
	// biome-ignore lint/correctness/useExhaustiveDependencies: key names the placements, so a rebuilt list that places the same models keeps the copies
	return useMemo(
		() =>
			enabled && placer
				? measurePerformance(
						"footprint.models-place",
						() => placer(placements, ({ model }) => templates.get(model.id)),
						{ placements: placements.length },
					)
				: undefined,
		[enabled, placer, key, templates],
	);
}
