import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
} from "solid-js";
import type { Object3D } from "three";
import type { PlacedModels } from "#/engine/footprint-models.ts";
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
	placements: Accessor<readonly ModelPlacement[]>,
	enabled: Accessor<boolean>,
	onError?: (message: string) => void,
): Accessor<PlacedModels | undefined> {
	const [engine, setEngine] = createSignal<ModelEngine>();
	const [library, setLibrary] = createSignal<BuiltinModelLibrary>();
	const [templates, setTemplates] = createSignal<ReadonlyMap<string, Object3D>>(
		new Map(),
	);
	const needsEngine = createMemo(() => enabled() && !(engine() && library()));
	createEffect(needsEngine, (needed) => {
		if (!needed) return;
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
	});
	const ids = createMemo(() =>
		enabled()
			? [...new Set(placements().map(({ model }) => model.id))]
					.sort()
					.join("\n")
			: "",
	);
	const request = createMemo(
		() => ({
			engine: engine(),
			library: library(),
			ids: ids(),
			loaded: templates(),
		}),
		{
			equals: (a, b) =>
				a.engine === b.engine && a.library === b.library && a.ids === b.ids,
		},
	);
	createEffect(request, ({ engine, library, ids, loaded }) => {
		if (!engine || !library || !ids) return;
		let current = true;
		for (const id of ids.split("\n")) {
			const model = library.byId.get(id);
			if (!model || loaded.has(id)) continue;
			measurePerformanceAsync("footprint.model-load", () =>
				engine.loadModelTemplate(model.url),
			).then(
				(template) => {
					if (current)
						setTemplates((previous) => new Map(previous).set(id, template));
				},
				() => {
					if (current) onError?.(`Unable to load the 3D model ${model.name}.`);
				},
			);
		}
		return () => {
			current = false;
		};
	});
	const placer = createMemo(() => engine()?.createModelPlacer());
	const placed = createMemo(() => placements(), {
		equals: (previous, next) => placementKey(previous) === placementKey(next),
	});
	return createMemo(() => {
		const place = placer();
		if (!enabled() || !place) return undefined;
		const current = placed();
		const loaded = templates();
		return measurePerformance(
			"footprint.models-place",
			() => place(current, ({ model }) => loaded.get(model.id)),
			{ placements: current.length },
		);
	});
}
