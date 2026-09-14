import { useCallback, useEffect, useRef, useState } from "react";
import type { SceneLayer } from "../../engine/types";
import { parseGerberFile } from "../../formats/parseGerberFile";

export function useGerberFile() {
	const request = useRef<AbortController | null>(null);
	const [state, setState] = useState<{
		layers: SceneLayer[];
		loading: boolean;
		message: string;
	}>({ layers: [], loading: false, message: "" });
	useEffect(() => () => request.current?.abort(), []);
	const openFile = useCallback(async (files: File[]) => {
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setState((previous) => ({ ...previous, loading: true, message: "" }));
		const layers: SceneLayer[] = [];
		const messages: string[] = [];
		try {
			for (const file of files) {
				try {
					const { layer, diagnostics } = await parseGerberFile(
						file,
						controller.signal,
					);
					if (controller.signal.aborted) return;
					const errors = diagnostics.filter(
						(entry) => entry.severity === "error",
					);
					if (errors.length)
						throw new Error(errors.map((entry) => entry.message).join("; "));
					if (!layer.objects.length)
						throw new Error("This file contains no drawable geometry.");
					const id = crypto.randomUUID();
					layers.push({
						...layer,
						id,
						objects: layer.objects.map((object) => ({
							...object,
							id: `${id}:${object.id}`,
						})),
						visible: true,
						opacity: 1,
					});
					messages.push(
						...diagnostics.map((entry) => `${file.name}: ${entry.message}`),
					);
				} catch (error) {
					if (controller.signal.aborted) return;
					messages.push(
						`${file.name}: ${error instanceof Error ? error.message : "Unable to read this file."}`,
					);
				}
			}
			setState((previous) => ({
				layers: [
					...previous.layers,
					...layers.map((layer, index) => ({
						...layer,
						color: [
							"#e8b77e",
							"#76b8e8",
							"#a99bea",
							"#78c9a5",
							"#e88ea1",
							"#d2cf7d",
						][(previous.layers.length + index) % 6],
					})),
				],
				loading: false,
				message: messages.join("; "),
			}));
		} finally {
			if (request.current === controller) request.current = null;
		}
	}, []);
	const setLayers = useCallback(
		(update: (layers: SceneLayer[]) => SceneLayer[]) => {
			setState((previous) => ({
				...previous,
				layers: update(previous.layers),
			}));
		},
		[],
	);
	return { ...state, openFile, setLayers };
}
