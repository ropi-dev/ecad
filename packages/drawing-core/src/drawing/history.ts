export const DRAWING_HISTORY_LIMIT = 100;

const immutableValues = new WeakSet<object>();

export function isImmutable(
	value: unknown,
	visiting = new WeakSet<object>(),
): boolean {
	if (typeof value === "function" || typeof value === "symbol") return false;
	if (value === null || typeof value !== "object") return true;
	if (immutableValues.has(value)) return true;
	if (!Object.isFrozen(value) || visiting.has(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (
		!Array.isArray(value) &&
		prototype !== Object.prototype &&
		prototype !== null
	)
		return false;
	visiting.add(value);
	const immutable = Reflect.ownKeys(value).every((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return (
			descriptor !== undefined &&
			"value" in descriptor &&
			isImmutable(descriptor.value, visiting)
		);
	});
	visiting.delete(value);
	if (immutable) immutableValues.add(value);
	return immutable;
}

function copyState<T>(state: T): T {
	return isImmutable(state) ? state : structuredClone(state);
}

export interface HistoryNode<T> {
	readonly id: number;
	readonly parentId: number | null;
	readonly childIds: readonly number[];
	readonly preferredChildId: number | null;
	readonly label: string;
	readonly state: Readonly<T>;
}

export interface History<T> {
	readonly nodes: Readonly<Record<number, HistoryNode<T>>>;
	readonly currentId: number;
	readonly nextId: number;
}

export function createHistory<T>(initial: T, label = "Start"): History<T> {
	return historyOf(copyState(initial), label);
}

export function historyOf<T>(state: T, label = "Start"): History<T> {
	return {
		nodes: {
			0: {
				id: 0,
				parentId: null,
				childIds: [],
				preferredChildId: null,
				label,
				state,
			},
		},
		currentId: 0,
		nextId: 1,
	};
}

export function getHistoryNode<T>(
	history: History<T>,
	nodeId = history.currentId,
): HistoryNode<T> | undefined {
	return history.nodes[nodeId];
}

/** Restoration receives its own copy so editing it cannot alter the saved node. */
export function getHistoryState<T>(history: History<T>): T {
	return structuredClone(history.nodes[history.currentId].state) as T;
}

export function commitHistory<T>(
	history: History<T>,
	state: T,
	label: string,
	isEqual: (previous: Readonly<T>, next: Readonly<T>) => boolean,
): History<T> {
	const parent = history.nodes[history.currentId];
	if (isEqual(parent.state, state)) return history;
	const id = history.nextId;
	return pruneHistory({
		nodes: {
			...history.nodes,
			[parent.id]: {
				...parent,
				childIds: [...parent.childIds, id],
				preferredChildId: id,
			},
			[id]: {
				id,
				parentId: parent.id,
				childIds: [],
				preferredChildId: null,
				label,
				state: copyState(state),
			},
		},
		currentId: id,
		nextId: id + 1,
	});
}

/** Visiting a branch makes it the preferred redo route from each ancestor. */
export function jumpHistory<T>(
	history: History<T>,
	nodeId: number,
): History<T> {
	if (nodeId === history.currentId || !history.nodes[nodeId]) return history;
	const nodes = { ...history.nodes };
	let child = nodes[nodeId];
	while (child.parentId !== null) {
		const parent = nodes[child.parentId];
		if (parent.preferredChildId !== child.id)
			nodes[parent.id] = { ...parent, preferredChildId: child.id };
		child = parent;
	}
	return { ...history, nodes, currentId: nodeId };
}

export function undoHistory<T>(history: History<T>): History<T> {
	const current = history.nodes[history.currentId];
	if (current.parentId === null) return history;
	const parent = history.nodes[current.parentId];
	return {
		...history,
		nodes: {
			...history.nodes,
			[parent.id]: { ...parent, preferredChildId: current.id },
		},
		currentId: parent.id,
	};
}

export function redoHistory<T>(
	history: History<T>,
	childId?: number,
): History<T> {
	const current = history.nodes[history.currentId];
	const target = childId ?? current.preferredChildId ?? current.childIds.at(-1);
	if (target === undefined || !current.childIds.includes(target))
		return history;
	return jumpHistory(history, target);
}

export function pruneHistory<T>(history: History<T>): History<T> {
	const entries = Object.values(history.nodes);
	if (entries.length <= DRAWING_HISTORY_LIMIT) return history;
	const nodes: Record<number, HistoryNode<T>> = { ...history.nodes };
	const candidates: number[] = [];
	const eligible = (node: HistoryNode<T>) =>
		node.id !== history.currentId &&
		(node.childIds.length === 0 ||
			(node.parentId === null && node.childIds.length === 1));
	const add = (id: number) => {
		let index = candidates.length;
		candidates.push(id);
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			if (candidates[parent] <= id) break;
			candidates[index] = candidates[parent];
			index = parent;
		}
		candidates[index] = id;
	};
	const take = () => {
		const first = candidates[0];
		const last = candidates.pop();
		if (last !== undefined && candidates.length) {
			let index = 0;
			while (index * 2 + 1 < candidates.length) {
				let child = index * 2 + 1;
				if (
					child + 1 < candidates.length &&
					candidates[child + 1] < candidates[child]
				)
					child++;
				if (candidates[child] >= last) break;
				candidates[index] = candidates[child];
				index = child;
			}
			candidates[index] = last;
		}
		return first;
	};
	for (const node of entries) if (eligible(node)) add(node.id);
	let size = entries.length;
	while (size > DRAWING_HISTORY_LIMIT) {
		const node = nodes[take()];
		delete nodes[node.id];
		size--;
		if (node.parentId === null) {
			const child = nodes[node.childIds[0]];
			nodes[child.id] = { ...child, parentId: null };
			if (eligible(nodes[child.id])) add(child.id);
		} else {
			const parent = nodes[node.parentId];
			const wasEligible = eligible(parent);
			const childIds = parent.childIds.filter((id) => id !== node.id);
			nodes[parent.id] = {
				...parent,
				childIds,
				preferredChildId:
					parent.preferredChildId === node.id
						? (childIds.at(-1) ?? null)
						: parent.preferredChildId,
			};
			if (!wasEligible && eligible(nodes[parent.id])) add(parent.id);
		}
	}
	return { ...history, nodes };
}
