import { Effect } from "effect";
import { useCallback, useEffect, useState } from "react";
import { useFileImport } from "#/components/viewer/useFileImport.ts";
import { ImportOwnership } from "#/formats/import-ownership.ts";
import {
	type ParsedStepFile,
	parseStepFileEffect,
} from "#/formats/parseStepFile.ts";
import { errorMessage } from "#/lib/error-message.ts";
import { useProjectActions } from "#/projects/ProjectProvider.tsx";

function readStep(file: File) {
	return Effect.map(parseStepFileEffect(file), (value) => ({ value }));
}

const release = (model: ParsedStepFile) => model.dispose();

export function useStepFile() {
	const readAssets = useProjectActions()?.readAssets;
	const [restoreError, setRestoreError] = useState("");
	const [model, updateModel] = useState<ParsedStepFile | null>(null);
	const [ownership] = useState(() => new ImportOwnership());
	const setModel = useCallback(
		(next: ParsedStepFile | null) => {
			ownership.stage(next ? [next.dispose] : []);
			updateModel(next);
		},
		[ownership],
	);
	useEffect(() => {
		ownership.commit(model ? [model.dispose] : []);
	}, [model, ownership]);
	useEffect(() => () => ownership.dispose(), [ownership]);
	const { loading, message, readFiles, cancel, clearMessage } = useFileImport(
		readStep,
		release,
		undefined,
		"step",
	);
	const openFile = useCallback(
		async (file: File) => {
			const models = await readFiles([file], (imported) => {
				if (imported.length) setModel(imported[0]);
			});
			// A successful load replaces an earlier restore problem.
			if (models?.length) setRestoreError("");
			return Boolean(models?.length);
		},
		[readFiles, setModel],
	);
	useEffect(() => {
		let cancelled = false;
		void readAssets?.("step")
			.then(async ({ files, problems }) => {
				if (cancelled) return;
				// Assets over the size limit are named; the newest valid one loads.
				setRestoreError(problems.join(" "));
				const file = files.at(-1);
				if (file)
					await readFiles(
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
	}, [readAssets, readFiles, setModel]);
	return {
		model,
		loading,
		message: [restoreError, message].filter(Boolean).join("; "),
		openFile,
		cancel,
		clear: () => {
			cancel();
			setModel(null);
			setRestoreError("");
			clearMessage();
		},
	};
}
