import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { Effect } from "effect";
import {
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
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

export function useGerberFile() {
	const readAssets = useProjectActions()?.readAssets;
	const [restoreError, setRestoreError] = useState("");
	const [layers, updateLayers] = useState<ParsedGerberObject[]>([]);
	const latest = useRef(layers);
	const [ownership] = useState(() => new ImportOwnership());
	const setLayers = useCallback(
		(action: SetStateAction<ParsedGerberObject[]>) => {
			const next =
				typeof action === "function" ? action(latest.current) : action;
			latest.current = next;
			ownership.stage(next.map((object) => object.dispose));
			updateLayers(next);
		},
		[ownership],
	);
	useEffect(() => {
		ownership.commit(layers.map((object) => object.dispose));
	}, [layers, ownership]);
	useEffect(() => () => ownership.dispose(), [ownership]);
	const theme = useTheme();
	const shownTheme = useRef(theme);
	useEffect(() => {
		const from = viewerThemes[shownTheme.current].layerPalette;
		const to = viewerThemes[theme].layerPalette;
		shownTheme.current = theme;
		if (from === to) return;
		setLayers((current) =>
			current.map((layer) => {
				const index = from.indexOf(layer.color);
				return index < 0 ? layer : { ...layer, color: to[index] };
			}),
		);
	}, [theme, setLayers]);
	const { loading, messages, readFiles } = useFileImport(
		readGerber,
		release,
		expandGerberFileEffect,
		"gerber",
	);
	const openFile = useCallback(
		async (files: File[]) => {
			const imported = await readFiles(files, (imported) => {
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
		},
		[readFiles, setLayers],
	);
	useEffect(() => {
		let cancelled = false;
		void readAssets?.("gerber")
			.then(async ({ files, problems }) => {
				if (cancelled) return;
				// Assets over the size limit are named; the others still load.
				setRestoreError(problems.join(" "));
				if (files.length)
					await readFiles(
						files,
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
	}, [readAssets, readFiles, setLayers]);
	return {
		layers,
		loading,
		messages: restoreError ? [restoreError, ...messages] : messages,
		openFile,
		setLayers,
	};
}
