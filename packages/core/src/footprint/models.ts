import type { DefaultModel } from "@ecad/default-models";
import { isBoardFootprint } from "@ecad/drawing-core/board/footprints.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { ModelReference } from "@ecad/drawing-core/footprint/model.ts";
import { useEffect, useState } from "react";
import type { BuiltinFootprintLibrary } from "#/footprint/library.ts";

export interface BuiltinModelLibrary {
	readonly models: readonly DefaultModel[];
	readonly byId: ReadonlyMap<string, DefaultModel>;
	readonly categories: readonly string[];
}

let loading: Promise<BuiltinModelLibrary> | undefined;
let loaded: BuiltinModelLibrary | undefined;

export function loadBuiltinModels(): Promise<BuiltinModelLibrary> {
	loading ??= import("@ecad/default-models").then(
		({ defaultModels }) => {
			const models = defaultModels();
			loaded = {
				models,
				byId: new Map(models.map((model) => [model.id, model])),
				categories: [...new Set(models.map(({ category }) => category))],
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

export function useBuiltinModels() {
	const [library, setLibrary] = useState(loaded);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (library) return;
		let current = true;
		loadBuiltinModels().then(
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

export interface ModelPlacement {
	readonly model: ModelReference;
	readonly x: number;
	readonly y: number;
	readonly rotation: number;
	readonly flipped: boolean;
}

export const footprintModelPlacements = (
	model: ModelReference | undefined,
): ModelPlacement[] =>
	model ? [{ model, x: 0, y: 0, rotation: 0, flipped: false }] : [];

export function boardModelPlacements(
	shapes: readonly EditorShape[],
	builtin: BuiltinFootprintLibrary | undefined,
	project: readonly { id: string; model?: ModelReference }[],
): ModelPlacement[] {
	const projectModels = new Map(project.map((file) => [file.id, file.model]));
	return shapes.flatMap((shape): ModelPlacement[] => {
		if (!isBoardFootprint(shape)) return [];
		const { library, id } = shape.footprint;
		const model =
			library === "builtin"
				? builtin?.byId.get(id)?.file.model
				: projectModels.get(id);
		return model
			? [
					{
						model,
						x: shape.x,
						y: shape.y,
						rotation: shape.rotation,
						flipped: shape.flipped === true,
					},
				]
			: [];
	});
}
