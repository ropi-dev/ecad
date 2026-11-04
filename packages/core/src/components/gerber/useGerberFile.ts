import { Effect } from "effect";
import {
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { expandGerberFileEffect } from "#/formats/expandGerberFile.ts";
import { ImportOwnership } from "#/formats/import-ownership.ts";
import {
	type ParsedGerberObject,
	parseGerberFileEffect,
} from "#/formats/parseGerberFile.ts";
import { errorMessage } from "#/lib/error-message.ts";
import { useProject } from "#/projects/ProjectProvider.tsx";
import { useFileImport } from "../viewer/useFileImport";

const COLORS = [
	"#e8b77e",
	"#76b8e8",
	"#a99bea",
	"#78c9a5",
	"#e88ea1",
	"#d2cf7d",
];

// Diagnostics stay on the layer, which shows them for as long as it exists.
function readGerber(file: File) {
	return Effect.map(parseGerberFileEffect(file), ({ object }) => ({
		value: object,
	}));
}
const release = (object: ParsedGerberObject) => object.dispose();

export function useGerberFile() {
	const readAssets = useProject()?.readAssets;
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
	const { loading, message, readFiles } = useFileImport(
		readGerber,
		release,
		expandGerberFileEffect,
		"gerber",
	);
	const openFile = useCallback(
		async (files: File[]) => {
			await readFiles(files, (imported) => {
				setLayers((previous) => [
					...previous,
					...imported.map((layer, index) => ({
						...layer,
						color: COLORS[(previous.length + index) % COLORS.length],
					})),
				]);
			});
		},
		[readFiles, setLayers],
	);
	useEffect(() => {
		let cancelled = false;
		void readAssets?.("gerber")
			.then(async (files) => {
				if (!cancelled && files.length)
					await readFiles(
						files,
						(imported) =>
							setLayers(
								imported.map((layer, index) => ({
									...layer,
									color: COLORS[index % COLORS.length],
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
		message: restoreError || message,
		openFile,
		setLayers,
	};
}
