import { useCallback, useEffect, useRef, useState } from "react";
import { parseStepFile } from "../../formats/parseStepFile";
import type { StepModel } from "../../formats/step/types/StepModel";

export function useStepFile() {
	const request = useRef<AbortController | null>(null);
	const [model, setModel] = useState<StepModel | null>(null);
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState("");
	useEffect(() => () => request.current?.abort(), []);
	const cancel = useCallback(() => {
		request.current?.abort();
		request.current = null;
		setLoading(false);
	}, []);
	const openFile = useCallback(async (file: File) => {
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setLoading(true);
		setMessage("");
		try {
			const result = await parseStepFile(file, controller.signal);
			if (controller.signal.aborted) return false;
			setModel(result);
			return true;
		} catch (error) {
			if (!controller.signal.aborted)
				setMessage(
					`${file.name}: ${error instanceof Error ? error.message : "Unable to read this file."}`,
				);
			return false;
		} finally {
			if (request.current === controller) {
				request.current = null;
				setLoading(false);
			}
		}
	}, []);
	return {
		model,
		loading,
		message,
		openFile,
		cancel,
		clear: () => {
			cancel();
			setModel(null);
			setMessage("");
		},
	};
}
