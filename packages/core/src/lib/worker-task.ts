import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";

export type WorkerReply<Result> =
	| { result: Result }
	| { error: string }
	| { unavailable: true };

export type AskWorker = <Result>(
	request: unknown,
	transfer?: Transferable[],
) => Promise<Result>;

class WorkerUnavailable extends Error {}

const SILENT_WORKER_MS = 30_000;

export async function workerReply<Result>(
	work: () => Result | Promise<Result>,
	fallback: string,
): Promise<WorkerReply<Result>> {
	try {
		return { result: await work() };
	} catch (cause) {
		return { error: errorMessage(cause, fallback) };
	}
}

export async function inWorkerOrHere<Result>(
	start: (() => Worker) | undefined,
	inWorker: (ask: AskWorker) => Promise<Result>,
	here: () => Result | Promise<Result>,
	{
		signal,
		timeout = SILENT_WORKER_MS,
	}: { signal?: AbortSignal; timeout?: number } = {},
): Promise<Result> {
	signal?.throwIfAborted();
	if (!start) return here();
	let worker: Worker;
	try {
		worker = start();
	} catch {
		return here();
	}
	let fail: (cause: unknown) => void = () => undefined;
	const failed = new Promise<never>((_, reject) => {
		fail = reject;
	});
	failed.catch(() => undefined);
	const stop = () => {
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
	};
	const unavailable = () => {
		stop();
		fail(new WorkerUnavailable());
	};
	const aborted = () => {
		stop();
		fail(signal?.reason);
	};
	worker.onerror = unavailable;
	worker.onmessageerror = unavailable;
	signal?.addEventListener("abort", aborted);
	const ask: AskWorker = <Reply>(
		request: unknown,
		transfer: Transferable[] = [],
	) => {
		const silent = setTimeout(unavailable, timeout);
		return Promise.race([
			failed,
			new Promise<Reply>((resolve, reject) => {
				worker.onmessage = (event: MessageEvent<WorkerReply<Reply>>) => {
					if ("unavailable" in event.data) unavailable();
					else if ("error" in event.data) reject(new Error(event.data.error));
					else resolve(event.data.result);
				};
				try {
					worker.postMessage(request, transfer);
				} catch {
					unavailable();
				}
			}),
		]).finally(() => clearTimeout(silent));
	};
	try {
		return await inWorker(ask);
	} catch (cause) {
		if (!(cause instanceof WorkerUnavailable)) throw cause;
	} finally {
		signal?.removeEventListener("abort", aborted);
		stop();
	}
	signal?.throwIfAborted();
	return here();
}
