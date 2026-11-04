/** Starts a task after every previously queued task has settled. */
export type SerialQueue = <T>(run: () => T | PromiseLike<T>) => Promise<T>;

/**
 * Runs tasks one at a time, in the order they were queued. A task that throws
 * or rejects fails only its own promise; the next task still runs.
 */
export function createSerialQueue(): SerialQueue {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(run: () => T | PromiseLike<T>) => {
		const next = tail.then(() => run());
		tail = next.catch(() => undefined);
		return next;
	};
}
