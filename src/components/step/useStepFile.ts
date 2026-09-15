import { useCallback, useState } from "react";
import { parseStepFile } from "#/formats/parseStepFile.ts";
import type { StepModel } from "#/formats/step/types/StepModel.ts";
import { useFileImport } from "../viewer/useFileImport";

async function readStep(file: File, signal: AbortSignal) {
	return { value: await parseStepFile(file, signal) };
}

export function useStepFile() {
	const [model, setModel] = useState<StepModel | null>(null);
	const { loading, message, readFiles, cancel, clearMessage } =
		useFileImport(readStep);
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
