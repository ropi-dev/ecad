import type { BoardRules } from "@ecad/drawing-core/board/rules.ts";

export interface BoardRulesStore {
	get(): BoardRules;
	set(rules: BoardRules): void;
	subscribe(listener: () => void): () => void;
}

export function createBoardRulesStore(initial: BoardRules): BoardRulesStore {
	let rules = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => rules,
		set(next) {
			if (
				Object.keys(next).every(
					(key) =>
						next[key as keyof BoardRules] === rules[key as keyof BoardRules],
				)
			)
				return;
			rules = next;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
