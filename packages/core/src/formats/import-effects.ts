import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { errorMessage } from "#/lib/error-message.ts";
import { fileSizeProblem, type ImportFormat } from "./import-limits.ts";

export class FileReadError extends Data.TaggedError("FileReadError")<{
	readonly message: string;
	readonly cause: unknown;
}> {}

export class InvalidFile extends Data.TaggedError("InvalidFile")<{
	readonly message: string;
}> {}

export class WorkerError extends Data.TaggedError("WorkerError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class ImportTimeout extends Data.TaggedError("ImportTimeout")<{
	readonly message: string;
}> {}

export class ArchiveError extends Data.TaggedError("ArchiveError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type ImportError =
	| FileReadError
	| InvalidFile
	| WorkerError
	| ImportTimeout
	| ArchiveError;

/** Compares `file.size` with the limit, so the file is never read when too large. */
export function checkFileSize(
	file: { readonly size: number },
	format: ImportFormat,
) {
	const problem = fileSizeProblem(format, file.size);
	return problem ? new InvalidFile({ message: problem }) : undefined;
}

export function readFile<A>(read: () => Promise<A>) {
	return Effect.tryPromise({
		try: read,
		catch: (cause) =>
			new FileReadError({
				message: errorMessage(cause, "Unable to read this file."),
				cause,
			}),
	});
}

/** The caller owns a value only after its entire import scope succeeds. */
export function acquireImported<A, E>(
	acquire: Effect.Effect<A, E>,
	dispose: (value: A) => void,
) {
	return Effect.acquireRelease(acquire, (value, exit) =>
		Exit.isFailure(exit) ? Effect.sync(() => dispose(value)) : Effect.void,
	);
}

interface WorkerRequest {
	create: () => Worker;
	message: unknown;
	transfer?: Transferable[];
	timeout: number;
	timeoutMessage: string;
	parseMessage: string;
	startMessage: string;
	receiveMessage: string;
}

/** Worker lifetime ends before a parsed model is handed to scene construction. */
export function requestWorker<A>(options: WorkerRequest) {
	return Effect.scoped(
		Effect.gen(function* () {
			const worker = yield* Effect.acquireRelease(
				Effect.try({
					try: options.create,
					catch: (cause) =>
						new WorkerError({ message: options.startMessage, cause }),
				}),
				(worker) =>
					Effect.sync(() => {
						worker.onmessage = null;
						worker.onerror = null;
						worker.onmessageerror = null;
						worker.terminate();
					}),
			);
			return yield* Effect.async<A, WorkerError>((resume) => {
				worker.onmessage = (
					event: MessageEvent<{ result?: A; error?: string }>,
				) => {
					const { result, error } = event.data;
					resume(
						error || result === undefined
							? Effect.fail(
									new WorkerError({ message: error || options.parseMessage }),
								)
							: Effect.succeed(result),
					);
				};
				worker.onerror = (event) =>
					resume(
						Effect.fail(
							new WorkerError({
								message: event.message || options.startMessage,
							}),
						),
					);
				worker.onmessageerror = () =>
					resume(
						Effect.fail(new WorkerError({ message: options.receiveMessage })),
					);
				try {
					worker.postMessage(options.message, options.transfer ?? []);
				} catch (cause) {
					resume(
						Effect.fail(
							new WorkerError({
								message: errorMessage(cause, options.startMessage),
								cause,
							}),
						),
					);
				}
			});
		}),
	).pipe(
		Effect.timeoutFail({
			duration: options.timeout,
			onTimeout: () => new ImportTimeout({ message: options.timeoutMessage }),
		}),
	);
}
