import { runEffect } from "@ecad/drawing-core/lib/effect.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { createSignal, onSettled } from "solid-js";
import { toastManager } from "#/components/ui/toast.ts";
import {
	type ExpandFile,
	type ImportFile,
	importFilesEffect,
} from "#/formats/importFiles.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";
import type { AssetKind } from "#/projects/format.ts";
import { useProjectActions } from "#/projects/ProjectProvider.tsx";

export function useFileImport<T>(
	parse: ImportFile<T>,
	dispose?: (value: T) => void,
	expand?: ExpandFile,
	kind?: () => AssetKind | undefined,
) {
	const actions = useProjectActions();
	let request: AbortController | null = null;
	let mounted = true;
	const [loading, setLoading] = createSignal(false);
	const [messages, setMessages] = createSignal<readonly string[]>([]);
	onSettled(() => {
		mounted = true;
		return () => {
			mounted = false;
			request?.abort();
			request = null;
		};
	});
	const cancel = () => {
		request?.abort();
		request = null;
		setLoading(false);
	};
	const clearMessage = () => setMessages([]);
	const readFiles = async (
		files: readonly File[],
		accept: (values: T[]) => void,
		persist = true,
	) => {
		const assetKind = kind?.();
		const importAssets = actions()?.importAssets;
		request?.abort();
		const controller = new AbortController();
		request = controller;
		setLoading(true);
		setMessages([]);
		try {
			const imported = await measurePerformanceAsync(
				`import.${assetKind ?? "files"}`,
				() =>
					runEffect(importFilesEffect(files, parse, expand), controller.signal),
				{
					files: files.length,
					bytes: files.reduce((sum, file) => sum + file.size, 0),
				},
			);
			if (controller.signal.aborted || request !== controller || !mounted) {
				for (const value of imported.values) dispose?.(value);
				return null;
			}
			try {
				// Rejected inputs, such as files over the size limit, are not stored.
				if (assetKind && persist && imported.accepted.length)
					await importAssets?.(imported.accepted, assetKind);
				if (controller.signal.aborted || request !== controller || !mounted) {
					for (const value of imported.values) dispose?.(value);
					return null;
				}
				accept(imported.values);
			} catch (error) {
				for (const value of imported.values) dispose?.(value);
				throw error;
			}
			setMessages(imported.messages);
			if (persist || imported.messages.length)
				toastManager.add({
					type: imported.messages.length
						? imported.values.length
							? "warning"
							: "error"
						: "success",
					title: imported.messages.length
						? imported.values.length
							? "Import completed with issues"
							: "Import failed"
						: "Files imported",
					description: imported.messages.length
						? imported.messages.join("\n")
						: `${imported.values.length} item${imported.values.length === 1 ? "" : "s"} added.`,
				});
			return imported.values;
		} catch (error) {
			if (controller.signal.aborted) return null;
			if (mounted) {
				const description = errorMessage(error, "Unable to import files.");
				setMessages([description]);
				toastManager.add({
					type: "error",
					title: "Import failed",
					description,
				});
			}
			return null;
		} finally {
			if (request === controller) {
				request = null;
				if (mounted) setLoading(false);
			}
		}
	};
	return {
		get loading() {
			return loading();
		},
		get message() {
			return messages().join("; ");
		},
		/** One entry per file problem, for workspaces that list them separately. */
		get messages() {
			return messages();
		},
		readFiles,
		cancel,
		clearMessage,
	};
}
