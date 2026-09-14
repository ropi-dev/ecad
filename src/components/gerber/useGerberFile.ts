import { useCallback, useEffect, useRef, useState } from "react";
import type { SceneLayer } from "../../engine/types";
import { parseGerberFile } from "../../formats/parseGerberFile";

export function useGerberFile() {
	const request = useRef<AbortController | null>(null);
	const [state, setState] = useState<{
		layer: SceneLayer | null;
		loading: boolean;
		message: string;
	}>({ layer: null, loading: false, message: "" });
	useEffect(() => () => request.current?.abort(), []);
	const openFile = useCallback(async (file: File) => {
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setState({ layer: null, loading: true, message: "" });
		try {
			const { layer, diagnostics } = await parseGerberFile(
				file,
				controller.signal,
			);
			if (controller.signal.aborted) return;
			const errors = diagnostics.filter((entry) => entry.severity === "error");
			if (errors.length)
				throw new Error(errors.map((entry) => entry.message).join("; "));
			if (!layer.objects.length)
				throw new Error("This file contains no drawable geometry.");
			setState({
				layer: { ...layer, color: "#e8b77e", visible: true, opacity: 1 },
				loading: false,
				message: diagnostics.map((entry) => entry.message).join("; "),
			});
		} catch (error) {
			if (!controller.signal.aborted)
				setState({
					layer: null,
					loading: false,
					message:
						error instanceof Error
							? error.message
							: "Unable to read this file.",
				});
		} finally {
			if (request.current === controller) request.current = null;
		}
	}, []);
	return { ...state, openFile };
}
