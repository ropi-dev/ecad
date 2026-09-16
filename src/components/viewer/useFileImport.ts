import { useCallback, useEffect, useRef, useState } from "react";

interface ParsedFile<T> {
	value: T;
	messages?: string[];
}

/** Owns cancellation and errors; callers decide how imported values are stored. */
export function useFileImport<T>(
	parse: (file: File, signal: AbortSignal) => Promise<ParsedFile<T>>,
	dispose?: (value: T) => void,
	expand?: (file: File, signal: AbortSignal) => Promise<readonly File[]>,
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
					let entries: readonly File[];
					try {
						entries = expand ? await expand(file, controller.signal) : [file];
					} catch (error) {
						if (controller.signal.aborted) return null;
						messages.push(
							`${file.name}: ${error instanceof Error ? error.message : "Unable to read this file."}`,
						);
						continue;
					}
					for (const entry of entries) {
						if (controller.signal.aborted) return null;
						try {
							const result = await parse(entry, controller.signal);
							values.push(result.value);
							if (controller.signal.aborted) return null;
							messages.push(
								...(result.messages ?? []).map(
									(text) => `${entry.name}: ${text}`,
								),
							);
						} catch (error) {
							if (controller.signal.aborted) return null;
							messages.push(
								`${entry.name}: ${error instanceof Error ? error.message : "Unable to read this file."}`,
							);
						}
					}
				}
				setMessage(messages.join("; "));
				return values;
			} finally {
				if (controller.signal.aborted)
					for (const value of values) dispose?.(value);
				if (request.current === controller) {
					request.current = null;
					setLoading(false);
				}
			}
		},
		[parse, dispose, expand],
	);
	return { loading, message, readFiles, cancel, clearMessage };
}
