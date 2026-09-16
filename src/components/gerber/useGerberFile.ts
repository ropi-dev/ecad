import { useCallback, useEffect, useRef, useState } from "react";
import { expandGerberFile } from "#/formats/expandGerberFile";
import {
	type ParsedGerberObject,
	parseGerberFile,
} from "#/formats/parseGerberFile.ts";
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
	const { object, diagnostics } = await parseGerberFile(file, signal);
	return { value: object, messages: diagnostics.map((entry) => entry.message) };
}
const release = (object: ParsedGerberObject) => object.dispose();

export function useGerberFile() {
	const [layers, setLayers] = useState<ParsedGerberObject[]>([]);
	const owned = useRef(new Set<() => void>());
	useEffect(() => {
		const next = new Set(layers.map((object) => object.dispose));
		for (const dispose of owned.current) if (!next.has(dispose)) dispose();
		owned.current = next;
	}, [layers]);
	useEffect(
		() => () => {
			for (const dispose of owned.current) dispose();
		},
		[],
	);
	const { loading, message, readFiles } = useFileImport(
		readGerber,
		release,
		expandGerberFile,
	);
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
