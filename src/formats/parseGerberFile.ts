import type { ParseResult } from "../engine/types";

export async function parseGerberFile(
	file: File,
	signal?: AbortSignal,
): Promise<ParseResult> {
	signal?.throwIfAborted();
	const source = await file.text();
	signal?.throwIfAborted();
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), {
			type: "module",
		});
		let settled = false;
		const finish = (error: unknown, result?: ParseResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			worker.terminate();
			if (result) resolve(result);
			else reject(error);
		};
		const abort = () =>
			finish(
				signal?.reason ??
					new DOMException("File loading cancelled.", "AbortError"),
			);
		const timeout = setTimeout(
			() => finish(new Error("Parsing timed out. Try a smaller file.")),
			20000,
		);
		signal?.addEventListener("abort", abort, { once: true });
		worker.onmessage = (
			event: MessageEvent<{ result?: ParseResult; error?: string }>,
		) => {
			if (event.data.error || !event.data.result)
				finish(new Error(event.data.error || "Unable to parse this file."));
			else finish(null, event.data.result);
		};
		worker.onerror = (event) =>
			finish(new Error(event.message || "Unable to parse this file."));
		try {
			if (signal?.aborted) abort();
			else worker.postMessage({ id: 0, source, filename: file.name });
		} catch (error) {
			finish(error);
		}
	});
}
