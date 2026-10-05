import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	importSymbolFiles,
	libraryDefinitions,
	mergeSymbolLibraries,
	type SymbolFile,
	type SymbolLibrary,
} from "#/components/editor/symbolFormat.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { runEffect } from "#/lib/effect.ts";
import {
	type SymbolLibrarySnapshot,
	useSymbolLibraryStorage,
} from "#/symbol-library/storage.tsx";

export function useSymbolLibrary() {
	const storage = useSymbolLibraryStorage();
	const [library, setLibrary] = useState<SymbolLibrary>([]);
	const currentLibrary = useRef<SymbolLibrary>([]);
	const [directory, setDirectory] = useState<string>();
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const request = useRef<AbortController | null>(null);

	const acceptSnapshot = useCallback((snapshot: SymbolLibrarySnapshot) => {
		const symbols = mergeSymbolLibraries([], snapshot.symbols);
		currentLibrary.current = symbols;
		setLibrary(symbols);
		setDirectory(snapshot.directory);
		if (snapshot.directory)
			setMessage(
				`Loaded ${symbols.length} symbols from ${snapshot.directory}.`,
			);
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		request.current = controller;
		currentLibrary.current = [];
		setLibrary([]);
		setDirectory(undefined);
		setLoading(true);
		setError("");
		setMessage("");
		void storage
			.load()
			.then((snapshot) => {
				if (!controller.signal.aborted) acceptSnapshot(snapshot);
			})
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error ? cause.message : "Unable to load symbols.",
					);
			})
			.finally(() => {
				if (request.current === controller && !controller.signal.aborted) {
					request.current = null;
					setLoading(false);
				}
			});
		return () => {
			controller.abort();
			request.current?.abort();
		};
	}, [storage, acceptSnapshot]);

	async function perform<T>(work: (signal: AbortSignal) => Promise<T>) {
		if (request.current)
			throw new Error("Wait for the symbol library to finish loading.");
		const controller = new AbortController();
		request.current = controller;
		setLoading(true);
		setError("");
		setMessage("");
		try {
			return await work(controller.signal);
		} catch (cause) {
			if (!controller.signal.aborted)
				setError(
					cause instanceof Error ? cause.message : "Unable to update symbols.",
				);
			throw cause;
		} finally {
			if (request.current === controller && !controller.signal.aborted) {
				request.current = null;
				setLoading(false);
			}
		}
	}

	async function saveLibrary(
		next: SymbolLibrary,
		incoming: SymbolLibrary,
		signal: AbortSignal,
	) {
		const persistenceMessage = await storage.save(next, incoming);
		if (signal.aborted) throw new Error("Symbol operation was cancelled.");
		currentLibrary.current = next;
		setLibrary(next);
		setMessage(
			`Added ${incoming.length} symbol${incoming.length === 1 ? "" : "s"}. ${persistenceMessage}`,
		);
	}

	function prepareAddition(symbol: SymbolFile) {
		const current = currentLibrary.current;
		const next = mergeSymbolLibraries(current, [symbol]);
		return () =>
			perform(async (signal) => {
				if (currentLibrary.current !== current)
					throw new Error(
						"The symbol library changed. Try creating the symbol again.",
					);
				await saveLibrary(next, [symbol], signal);
			});
	}

	async function upload(files: readonly File[], directoryUpload = false) {
		try {
			await perform(async (signal) => {
				const incoming = await runEffect(
					importSymbolFiles(files, directoryUpload),
					signal,
				);
				if (signal.aborted) return;
				const next = mergeSymbolLibraries(currentLibrary.current, incoming);
				await saveLibrary(next, incoming, signal);
			});
		} catch {
			/* perform reports import and persistence errors in the picker. */
		}
	}

	async function openDirectory() {
		if (!storage.openDirectory) return;
		try {
			await perform(async (signal) => {
				const snapshot = await storage.openDirectory?.();
				if (snapshot && !signal.aborted) acceptSnapshot(snapshot);
			});
		} catch {
			/* Keep the previous library available when opening fails. */
		}
	}

	async function refresh() {
		try {
			await perform(async (signal) => {
				const snapshot = await storage.load();
				if (!signal.aborted) acceptSnapshot(snapshot);
			});
		} catch {
			/* Keep the previous library available when a disk read fails. */
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
		prepareAddition,
		directory,
		mode: storage.mode,
		canOpenDirectory: !!storage.openDirectory,
		openDirectory,
		refresh,
	};
}
