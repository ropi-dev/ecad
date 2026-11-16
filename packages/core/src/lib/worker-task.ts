import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";

export type WorkerReply<Result> =
	| { result: Result }
	| { error: string }
	| { unavailable: true };

export type AskWorker = <Result>(
	request: unknown,
	transfer?: Transferable[],
) => Promise<Result>;

export interface TaskWorker {
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent) => void) | null;
	postMessage(message: unknown, transfer: Transferable[]): void;
	terminate(): void;
}

class WorkerUnavailable extends Error {}

const SILENT_WORKER_MS = 30_000;
const WARM_WORKER_MS = 60_000;

export function keepWarm(
	start: () => TaskWorker,
	idle = WARM_WORKER_MS,
): () => TaskWorker {
	let parked:
		| { worker: TaskWorker; timer: ReturnType<typeof setTimeout> }
		| undefined;
	return () => {
		const worker = parked?.worker ?? start();
		clearTimeout(parked?.timer);
		parked = undefined;
		let pending = 0;
		let broken = false;
		let released = false;
		const task: TaskWorker = {
			onmessage: null,
			onerror: null,
			onmessageerror: null,
			postMessage(message, transfer) {
				pending++;
				worker.postMessage(message, transfer);
			},
			terminate() {
				if (released) return;
				released = true;
				worker.onmessage = null;
				worker.onerror = null;
				worker.onmessageerror = null;
				if (pending || broken || parked) {
					worker.terminate();
					return;
				}
				const timer = setTimeout(() => {
					if (parked?.worker === worker) parked = undefined;
					worker.terminate();
				}, idle);
				(timer as { unref?: () => void }).unref?.();
				parked = { worker, timer };
			},
		};
		worker.onmessage = (event) => {
			pending--;
			task.onmessage?.(event);
		};
		worker.onerror = (event) => {
			broken = true;
			task.onerror?.(event);
		};
		worker.onmessageerror = (event) => {
			broken = true;
			task.onmessageerror?.(event);
		};
		return task;
	};
}

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
	start: (() => TaskWorker) | undefined,
	inWorker: (ask: AskWorker) => Promise<Result>,
	here: () => Result | Promise<Result>,
	{
		signal,
		timeout = SILENT_WORKER_MS,
	}: { signal?: AbortSignal; timeout?: number } = {},
): Promise<Result> {
	signal?.throwIfAborted();
	if (!start) return here();
	let worker: TaskWorker;
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
