export type SerialQueue = <T>(run: () => T | PromiseLike<T>) => Promise<T>;

export function createSerialQueue(): SerialQueue {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(run: () => T | PromiseLike<T>) => {
		const next = tail.then(() => run());
		tail = next.catch(() => undefined);
		return next;
	};
}
