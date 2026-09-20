import { useCallback, useEffect, useRef, useState } from "react";
import {
	type ExpandFile,
	type ImportFile,
	importFilesEffect,
} from "#/formats/importFiles";
import { runEffect } from "#/lib/effect";

/** Runs imports at the React boundary; parsers register ownership in the scope. */
export function useFileImport<T>(
	parse: ImportFile<T>,
	dispose?: (value: T) => void,
	expand?: ExpandFile,
) {
	const request = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState("");
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			request.current?.abort();
			request.current = null;
		};
	}, []);
	const cancel = useCallback(() => {
		request.current?.abort();
		request.current = null;
		setLoading(false);
	}, []);
	const clearMessage = useCallback(() => setMessage(""), []);
	const readFiles = useCallback(
		async (files: readonly File[], accept: (values: T[]) => void) => {
			request.current?.abort();
			const controller = new AbortController();
			request.current = controller;
			setLoading(true);
			setMessage("");
			try {
				const imported = await runEffect(
					importFilesEffect(files, parse, expand),
					controller.signal,
				);
				// A completed Effect can be superseded before its Promise is observed.
				if (
					controller.signal.aborted ||
					request.current !== controller ||
					!mounted.current
				) {
					for (const value of imported.values) dispose?.(value);
					return null;
				}
				// Register ownership before another microtask can cancel or unmount.
				try {
					accept(imported.values);
				} catch (error) {
					for (const value of imported.values) dispose?.(value);
					throw error;
				}
				setMessage(imported.messages.join("; "));
				return imported.values;
			} catch (error) {
				if (controller.signal.aborted) return null;
				throw error;
			} finally {
				if (request.current === controller) {
					request.current = null;
					if (mounted.current) setLoading(false);
				}
			}
		},
		[parse, dispose, expand],
	);
	return { loading, message, readFiles, cancel, clearMessage };
}
