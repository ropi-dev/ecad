export interface UnionFind {
	/** Returns the representative of the set that contains `index`. */
	find(index: number): number;
	/** Merges the set containing `index` into the set containing `into`. */
	union(index: number, into: number): void;
}

/** Disjoint sets over `0..size-1`, with path halving. */
export function unionFind(size: number): UnionFind {
	const parents = Array.from({ length: size }, (_, index) => index);
	const find = (index: number) => {
		while (parents[index] !== index) {
			parents[index] = parents[parents[index]];
			index = parents[index];
		}
		return index;
	};
	return {
		find,
		union(index, into) {
			parents[find(index)] = find(into);
		},
	};
}
