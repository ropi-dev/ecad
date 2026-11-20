import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { Effect } from "effect";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import { useFileImport } from "#/components/viewer/useFileImport.ts";
import { viewerTheme, viewerThemes } from "#/drawing/schematic-theme.ts";
import { expandGerberFileEffect } from "#/formats/expandGerberFile.ts";
import { ImportOwnership } from "#/formats/import-ownership.ts";
import {
	type ParsedGerberObject,
	parseGerberFileEffect,
} from "#/formats/parseGerberFile.ts";
import { useProjectActions } from "#/projects/ProjectProvider.tsx";
import { useTheme } from "#/settings/theme.ts";

const paletteColor = (index: number) => {
	const palette = viewerTheme().layerPalette;
	return palette[index % palette.length];
};

// Diagnostics stay on the layer, which shows them for as long as it exists.
function readGerber(file: File) {
	return Effect.map(parseGerberFileEffect(file), ({ object }) => ({
		value: object,
	}));
}
const release = (object: ParsedGerberObject) => object.dispose();

type LayersAction =
	| ParsedGerberObject[]
	| ((previous: ParsedGerberObject[]) => ParsedGerberObject[]);

export function useGerberFile() {
	const actions = useProjectActions();
	const [restoreError, setRestoreError] = createSignal("");
	const [layers, updateLayers] = createSignal<ParsedGerberObject[]>([]);
	let latest: ParsedGerberObject[] = [];
	const ownership = new ImportOwnership();
	const setLayers = (action: LayersAction) => {
		const next = typeof action === "function" ? action(latest) : action;
		latest = next;
		ownership.stage(next.map((object) => object.dispose));
		updateLayers(next);
	};
	createEffect(layers, (shown) => {
		ownership.commit(shown.map((object) => object.dispose));
	});
	onSettled(() => () => ownership.dispose());
	const theme = useTheme();
	createEffect(theme, (shown, previous) => {
		if (previous === undefined) return;
		const from = viewerThemes[previous].layerPalette;
		const to = viewerThemes[shown].layerPalette;
		if (from === to) return;
		setLayers((current) =>
			current.map((layer) => {
				const index = from.indexOf(layer.color);
				return index < 0 ? layer : { ...layer, color: to[index] };
			}),
		);
	});
	const files = useFileImport(
		readGerber,
		release,
		expandGerberFileEffect,
		() => "gerber" as const,
	);
	const openFile = async (selected: File[]) => {
		const imported = await files.readFiles(selected, (imported) => {
			setLayers((previous) => [
				...previous,
				...imported.map((layer, index) => ({
					...layer,
					color: paletteColor(previous.length + index),
				})),
			]);
		});
		// A successful load replaces an earlier restore problem.
		if (imported?.length) setRestoreError("");
	};
	const readAssets = createMemo(() => actions()?.readAssets);
	createEffect(readAssets, (read) => {
		let cancelled = false;
		void read?.("gerber")
			.then(async ({ files: assets, problems }) => {
				if (cancelled) return;
				// Assets over the size limit are named; the others still load.
				setRestoreError(problems.join(" "));
				if (assets.length)
					await files.readFiles(
						assets,
						(imported) =>
							setLayers(
								imported.map((layer, index) => ({
									...layer,
									color: paletteColor(index),
								})),
							),
						false,
					);
			})
			.catch((cause: unknown) => {
				if (!cancelled)
					setRestoreError(
						errorMessage(cause, "Unable to load project assets."),
					);
			});
		return () => {
			cancelled = true;
		};
	});
	return {
		get layers() {
			return layers();
		},
		get loading() {
			return files.loading;
		},
		get messages(): readonly string[] {
			const error = restoreError();
			return error ? [error, ...files.messages] : files.messages;
		},
		openFile,
		setLayers,
	};
}
