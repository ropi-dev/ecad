import { useCallback, useEffect, useRef, useState } from "react";

interface ParsedFile<T> {
	value: T;
	messages?: string[];
}

/** Owns cancellation and errors; callers decide how imported values are stored. */
export function useFileImport<T>(
	parse: (file: File, signal: AbortSignal) => Promise<ParsedFile<T>>,
) {
	const request = useRef<AbortController | null>(null);
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState("");
	useEffect(() => () => request.current?.abort(), []);
	const cancel = useCallback(() => {
		request.current?.abort();
		request.current = null;
		setLoading(false);
	}, []);
	const clearMessage = useCallback(() => setMessage(""), []);
	const readFiles = useCallback(
		async (files: readonly File[]) => {
			request.current?.abort();
			const controller = new AbortController();
			request.current = controller;
			setLoading(true);
			setMessage("");
			const values: T[] = [];
			const messages: string[] = [];
			try {
				for (const file of files) {
					try {
						const result = await parse(file, controller.signal);
						if (controller.signal.aborted) return null;
						values.push(result.value);
						messages.push(
							...(result.messages ?? []).map((text) => `${file.name}: ${text}`),
						);
					} catch (error) {
						if (controller.signal.aborted) return null;
						messages.push(
							`${file.name}: ${error instanceof Error ? error.message : "Unable to read this file."}`,
						);
					}
				}
				setMessage(messages.join("; "));
				return values;
			} finally {
				if (request.current === controller) {
					request.current = null;
					setLoading(false);
				}
			}
		},
		[parse],
	);
	return { loading, message, readFiles, cancel, clearMessage };
}
