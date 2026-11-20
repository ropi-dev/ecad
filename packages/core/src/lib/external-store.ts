import {
	type Accessor,
	createSignal,
	getOwner,
	isHydrating,
	onCleanup,
	onSettled,
	untrack,
} from "solid-js";

export interface ExternalStore<T> {
	subscribe(listener: () => void): () => void;
	getSnapshot(): T;
	getServerSnapshot?(): T;
}

export function shallowEqual(a: unknown, b: unknown) {
	if (Object.is(a, b)) return true;
	if (
		typeof a !== "object" ||
		a === null ||
		typeof b !== "object" ||
		b === null ||
		Array.isArray(a) !== Array.isArray(b)
	)
		return false;
	const left = Object.keys(a);
	if (left.length !== Object.keys(b).length) return false;
	return left.every((key) =>
		Object.is(
			(a as Record<string, unknown>)[key],
			(b as Record<string, unknown>)[key],
		),
	);
}

export function fromExternalStore<T>(
	subscribe: (listener: () => void) => () => void,
	getSnapshot: () => T,
	options: {
		equals?: false | ((prev: T, next: T) => boolean);
		serverSnapshot?: () => T;
	} = {},
): Accessor<T> {
	const hydrating = options.serverSnapshot !== undefined && isHydrating();
	const initial = hydrating ? (options.serverSnapshot as () => T) : getSnapshot;
	const [value, setValue] = createSignal<T>(untrack(initial) as never, {
		ownedWrite: true,
		...(options.equals === undefined ? {} : { equals: options.equals }),
	});
	const stop = subscribe(() => setValue(() => getSnapshot()));
	if (options.serverSnapshot)
		onSettled(() => {
			if (hydrating) setValue(() => getSnapshot());
		});
	if (getOwner()) onCleanup(stop);
	return value;
}

export const useExternalStore = <T>(store: ExternalStore<T>): Accessor<T> =>
	fromExternalStore(
		(listener) => store.subscribe(listener),
		() => store.getSnapshot(),
		store.getServerSnapshot
			? { serverSnapshot: () => store.getServerSnapshot?.() as T }
			: {},
	);
