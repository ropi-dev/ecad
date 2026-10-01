import { useEffect, useMemo, useRef, useState } from "react";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { runEffect } from "#/lib/effect";
import {
	importSymbolFiles,
	libraryDefinitions,
	mergeSymbolLibraries,
	parseSavedSymbolLibrary,
	SYMBOL_STORAGE_KEY,
	type SymbolLibrary,
} from "./symbolFormat";

export function useSymbolLibrary() {
	const [library, setLibrary] = useState<SymbolLibrary>([]);
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const request = useRef<AbortController | null>(null);
	useEffect(() => {
		try {
			const stored = localStorage.getItem(SYMBOL_STORAGE_KEY);
			if (stored) setLibrary(parseSavedSymbolLibrary(stored));
		} catch {
			setError(
				"Saved symbols could not be loaded. You can upload a library again.",
			);
		}
		return () => request.current?.abort();
	}, []);

	async function upload(files: readonly File[], directory = false) {
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setLoading(true);
		setError("");
		setMessage("");
		try {
			const incoming = await runEffect(
				importSymbolFiles(files, directory),
				controller.signal,
			);
			if (controller.signal.aborted) return;
			const next = mergeSymbolLibraries(library, incoming);
			let saved = true;
			try {
				localStorage.setItem(SYMBOL_STORAGE_KEY, JSON.stringify(next));
			} catch {
				saved = false;
			}
			setLibrary(next);
			setMessage(
				`Added ${incoming.length} symbol${incoming.length === 1 ? "" : "s"}. ${saved ? "Saved in this browser." : "Browser storage is unavailable; these symbols will be lost when you leave or reload the editor."}`,
			);
		} catch (cause) {
			if (!controller.signal.aborted)
				setError(
					cause instanceof Error
						? cause.message
						: "Unable to import these symbol files.",
				);
		} finally {
			if (request.current === controller && !controller.signal.aborted) {
				request.current = null;
				setLoading(false);
			}
		}
	}

	const definitions = useMemo(
		() => [...symbolDefinitions, ...libraryDefinitions(library)],
		[library],
	);
	return {
		definitions,
		loading,
		message,
		error,
		upload,
	};
}
