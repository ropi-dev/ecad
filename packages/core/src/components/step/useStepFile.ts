import { Effect } from "effect";
import { useCallback, useEffect, useState } from "react";
import { ImportOwnership } from "#/formats/import-ownership.ts";
import {
	type ParsedStepFile,
	parseStepFileEffect,
} from "#/formats/parseStepFile.ts";
import { useFileImport } from "../viewer/useFileImport";

function readStep(file: File) {
	return Effect.map(parseStepFileEffect(file), (value) => ({ value }));
}

const release = (model: ParsedStepFile) => model.dispose();

export function useStepFile() {
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
	);
	const openFile = useCallback(
		async (file: File) => {
			const models = await readFiles([file], (imported) => {
				if (imported.length) setModel(imported[0]);
			});
			return Boolean(models?.length);
		},
		[readFiles, setModel],
	);
	return {
		model,
		loading,
		message,
		openFile,
		cancel,
		clear: () => {
			cancel();
			setModel(null);
			clearMessage();
		},
	};
}
