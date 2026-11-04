/** History values must be structured-cloneable and treated as read-only. */
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
	return {
		nodes: {
			0: {
				id: 0,
				parentId: null,
				childIds: [],
				preferredChildId: null,
				label,
				state: structuredClone(initial),
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
	// The comparison only reads the saved state, so it skips the restoration copy.
	if (isEqual(parent.state, state)) return history;
	const id = history.nextId;
	return {
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
				state: structuredClone(state),
			},
		},
		currentId: id,
		nextId: id + 1,
	};
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
