import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { Effect } from "effect";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import { useFileImport } from "#/components/viewer/useFileImport.ts";
import { ImportOwnership } from "#/formats/import-ownership.ts";
import {
	type ParsedStepFile,
	parseStepFileEffect,
} from "#/formats/parseStepFile.ts";
import { useProjectActions } from "#/projects/ProjectProvider.tsx";

function readStep(file: File) {
	return Effect.map(parseStepFileEffect(file), (value) => ({ value }));
}

const release = (model: ParsedStepFile) => model.dispose();

export function useStepFile() {
	const actions = useProjectActions();
	const [restoreError, setRestoreError] = createSignal("");
	const [model, updateModel] = createSignal<ParsedStepFile | null>(null);
	const ownership = new ImportOwnership();
	const setModel = (next: ParsedStepFile | null) => {
		ownership.stage(next ? [next.dispose] : []);
		updateModel(() => next);
	};
	createEffect(model, (shown) => {
		ownership.commit(shown ? [shown.dispose] : []);
	});
	onSettled(() => () => ownership.dispose());
	const files = useFileImport(
		readStep,
		release,
		undefined,
		() => "step" as const,
	);
	const openFile = async (file: File) => {
		const models = await files.readFiles([file], (imported) => {
			if (imported.length) setModel(imported[0]);
		});
		// A successful load replaces an earlier restore problem.
		if (models?.length) setRestoreError("");
		return Boolean(models?.length);
	};
	const readAssets = createMemo(() => actions()?.readAssets);
	createEffect(readAssets, (read) => {
		let cancelled = false;
		void read?.("step")
			.then(async ({ files: assets, problems }) => {
				if (cancelled) return;
				// Assets over the size limit are named; the newest valid one loads.
				setRestoreError(problems.join(" "));
				const file = assets.at(-1);
				if (file)
					await files.readFiles(
						[file],
						(imported) => {
							if (imported.length) setModel(imported[0]);
						},
						false,
					);
			})
			.catch((cause: unknown) => {
				if (!cancelled)
					setRestoreError(
						errorMessage(cause, "Unable to load project assets."),
					);
			});
		return () => {
			cancelled = true;
		};
	});
	return {
		get model() {
			return model();
		},
		get loading() {
			return files.loading;
		},
		get message() {
			return [restoreError(), files.message].filter(Boolean).join("; ");
		},
		openFile,
		cancel: () => files.cancel(),
		clear: () => {
			files.cancel();
			setModel(null);
			setRestoreError("");
			files.clearMessage();
		},
	};
}
