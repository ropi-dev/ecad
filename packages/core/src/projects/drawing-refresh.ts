import { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";

/**
 * Replaces a drawing store's shapes with saved shapes without recording an
 * edit. External shapes did not come from this store's commands, so they
 * start a new history. Otherwise the current history entry takes the
 * shapes, so undo still steps back through the local edits.
 */
export function replaceDrawingShapes(
	target: ReturnType<typeof createDrawingStore>,
	shapes: EditorShape[],
	external: boolean,
) {
	if (target.getSnapshot().shapes === shapes) return;
	target.transact((current) => [
		undefined,
		{
			...current,
			shapes,
			history: external
				? createDrawingStore(shapes).getSnapshot().history
				: {
						...current.history,
						nodes: {
							...current.history.nodes,
							[current.history.currentId]: {
								...current.history.nodes[current.history.currentId],
								state: { shapes },
							},
						},
					},
			nextShapeId: Math.max(
				current.nextShapeId,
				shapes.reduce((max, shape) => Math.max(max, shape.id), 0) + 1,
			),
		},
	]);
}
