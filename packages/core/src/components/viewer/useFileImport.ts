import { useCallback, useEffect, useRef, useState } from "react";
import {
	type ExpandFile,
	type ImportFile,
	importFilesEffect,
} from "#/formats/importFiles.ts";
import { runEffect } from "#/lib/effect.ts";
import { errorMessage } from "#/lib/error-message.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";
import type { AssetKind } from "#/projects/format.ts";
import { useProject } from "#/projects/ProjectProvider.tsx";

export function useFileImport<T>(
	parse: ImportFile<T>,
	dispose?: (value: T) => void,
	expand?: ExpandFile,
	kind?: AssetKind,
) {
	const importAssets = useProject()?.importAssets;
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
		async (
			files: readonly File[],
			accept: (values: T[]) => void,
			persist = true,
		) => {
			request.current?.abort();
			const controller = new AbortController();
			request.current = controller;
			setLoading(true);
			setMessage("");
			try {
				const imported = await measurePerformanceAsync(
					`import.${kind ?? "files"}`,
					() =>
						runEffect(
							importFilesEffect(files, parse, expand),
							controller.signal,
						),
					{
						files: files.length,
						bytes: files.reduce((sum, file) => sum + file.size, 0),
					},
				);
				if (
					controller.signal.aborted ||
					request.current !== controller ||
					!mounted.current
				) {
					for (const value of imported.values) dispose?.(value);
					return null;
				}
				try {
					if (kind && persist && imported.values.length)
						await importAssets?.(files, kind);
					if (
						controller.signal.aborted ||
						request.current !== controller ||
						!mounted.current
					) {
						for (const value of imported.values) dispose?.(value);
						return null;
					}
					accept(imported.values);
				} catch (error) {
					for (const value of imported.values) dispose?.(value);
					throw error;
				}
				setMessage(imported.messages.join("; "));
				return imported.values;
			} catch (error) {
				if (controller.signal.aborted) return null;
				if (mounted.current)
					setMessage(errorMessage(error, "Unable to import files."));
				return null;
			} finally {
				if (request.current === controller) {
					request.current = null;
					if (mounted.current) setLoading(false);
				}
			}
		},
		[parse, dispose, expand, kind, importAssets],
	);
	return { loading, message, readFiles, cancel, clearMessage };
}
