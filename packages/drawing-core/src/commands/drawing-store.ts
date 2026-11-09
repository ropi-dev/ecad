import * as Context from "effect/Context";
import { type History, historyOf, pruneHistory } from "#/drawing/history.ts";
import {
	canonicalShapePages,
	type DrawingPage,
	savedPages,
} from "#/drawing/pages.ts";
import type { EditorShape } from "#/drawing/shapes.ts";
import { freeze } from "#/lib/freeze.ts";

export interface DrawingDocument {
	readonly shapes: EditorShape[];
	/**
	 * Schematic pages in order. Absent means the single default page. Every
	 * commit, including one that only changes pages, publishes a new `shapes`
	 * array, so callers can detect any document change by `shapes` identity.
	 */
	readonly pages?: readonly DrawingPage[];
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
	pages?: readonly DrawingPage[],
): DrawingStoreService {
	const saved = savedPages(pages);
	// Loaded files may name the first page explicitly; commits never do.
	const canonical = canonicalShapePages(shapes, saved);
	const document: DrawingDocument = saved
		? { shapes: canonical, pages: saved }
		: { shapes: canonical };
	return restoreDrawingStore({
		...document,
		history: historyOf<DrawingDocument>(
			document,
			shapes.length ? "Loaded drawing" : "Empty drawing",
		),
		nextShapeId:
			shapes.reduce((maximum, shape) => Math.max(maximum, shape.id), 0) + 1,
	});
}

export function restoreDrawingStore(
	initial: DrawingSnapshot,
): DrawingStoreService {
	const history = pruneHistory(initial.history);
	let snapshot = freeze(structuredClone({ ...initial, history }));
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
