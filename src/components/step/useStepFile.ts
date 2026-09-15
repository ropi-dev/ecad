import { useCallback, useEffect, useState } from "react";
import { type ParsedStepFile, parseStepFile } from "#/formats/parseStepFile.ts";
import { useFileImport } from "../viewer/useFileImport";

async function readStep(file: File, signal: AbortSignal) {
	return { value: await parseStepFile(file, signal) };
}

const release = (model: ParsedStepFile) => model.dispose();

export function useStepFile() {
	const [model, setModel] = useState<ParsedStepFile | null>(null);
	useEffect(() => () => model?.dispose(), [model]);
	const { loading, message, readFiles, cancel, clearMessage } = useFileImport(
		readStep,
		release,
	);
	const openFile = useCallback(
		async (file: File) => {
			const models = await readFiles([file]);
			if (!models?.length) return false;
			setModel(models[0]);
			return true;
		},
		[readFiles],
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
