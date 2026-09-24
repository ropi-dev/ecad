import { Context } from "effect";
import { createHistory, type History } from "#/drawing/history";
import type { EditorShape } from "#/drawing/shapes";

export interface DrawingDocument {
	readonly shapes: EditorShape[];
}

export interface DrawingSnapshot extends DrawingDocument {
	readonly history: History<DrawingDocument>;
	readonly nextShapeId: number;
}

interface DrawingStoreService {
	readonly getSnapshot: () => DrawingSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	/** Commands prepare and publish an entire transaction synchronously. */
	readonly transact: <A>(
		transition: (current: DrawingSnapshot) => readonly [A, DrawingSnapshot],
	) => A;
}

export class DrawingStore extends Context.Tag("ecad/DrawingStore")<
	DrawingStore,
	DrawingStoreService
>() {}

function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

/** A drawing exists independently of any React component or rendering backend. */
export function createDrawingStore(): DrawingStoreService {
	let snapshot = freeze<DrawingSnapshot>({
		shapes: [],
		history: createHistory<DrawingDocument>({ shapes: [] }, "Empty drawing"),
		nextShapeId: 1,
	});
	const listeners = new Set<() => void>();
	return DrawingStore.of({
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		transact: (transition) => {
			const [result, next] = transition(snapshot);
			if (next !== snapshot) {
				snapshot = freeze(next);
				for (const listener of listeners) listener();
			}
			return result;
		},
	});
}
