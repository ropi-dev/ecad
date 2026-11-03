import * as Context from "effect/Context";
import { createHistory, type History } from "#/drawing/history.ts";
import type { EditorShape } from "#/drawing/shapes.ts";
import { freeze } from "#/lib/freeze.ts";

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

/** A drawing exists independently of any React component or rendering backend. */
export function createDrawingStore(
	shapes: EditorShape[] = [],
): DrawingStoreService {
	return restoreDrawingStore({
		shapes,
		history: createHistory<DrawingDocument>(
			{ shapes },
			shapes.length ? "Loaded drawing" : "Empty drawing",
		),
		nextShapeId:
			shapes.reduce((maximum, shape) => Math.max(maximum, shape.id), 0) + 1,
	});
}

export function restoreDrawingStore(
	initial: DrawingSnapshot,
): DrawingStoreService {
	let snapshot = freeze(structuredClone(initial));
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
