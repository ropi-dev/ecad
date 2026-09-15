import { useCallback, useState } from "react";
import type { SceneLayer } from "../../engine/types";
import { parseGerberFile } from "../../formats/parseGerberFile";
import { useFileImport } from "../viewer/useFileImport";

const COLORS = [
	"#e8b77e",
	"#76b8e8",
	"#a99bea",
	"#78c9a5",
	"#e88ea1",
	"#d2cf7d",
];

async function readGerber(file: File, signal: AbortSignal) {
	const { layer, diagnostics } = await parseGerberFile(file, signal);
	const errors = diagnostics.filter((entry) => entry.severity === "error");
	if (errors.length)
		throw new Error(errors.map((entry) => entry.message).join("; "));
	if (!layer.objects.length)
		throw new Error("This file contains no drawable geometry.");
	const id = crypto.randomUUID();
	return {
		value: {
			...layer,
			id,
			objects: layer.objects.map((object) => ({
				...object,
				id: `${id}:${object.id}`,
			})),
			visible: true,
			opacity: 1,
		},
		messages: diagnostics.map((entry) => entry.message),
	};
}

export function useGerberFile() {
	const [layers, setLayers] = useState<SceneLayer[]>([]);
	const { loading, message, readFiles } = useFileImport(readGerber);
	const openFile = useCallback(
		async (files: File[]) => {
			const imported = await readFiles(files);
			if (!imported) return;
			setLayers((previous) => [
				...previous,
				...imported.map((layer, index) => ({
					...layer,
					color: COLORS[(previous.length + index) % COLORS.length],
				})),
			]);
		},
		[readFiles],
	);
	return { layers, loading, message, openFile, setLayers };
}
