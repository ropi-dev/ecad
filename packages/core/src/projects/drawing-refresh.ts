import { sameShape } from "@ecad/drawing-core/commands/drawing-equality.ts";
import type {
	createDrawingStore,
	DrawingDocument,
	DrawingSnapshot,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { historyOf } from "@ecad/drawing-core/drawing/history.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";

/**
 * Replaces a drawing store's shapes with saved shapes without recording an
 * edit. External shapes did not come from this store's commands, so they
 * start a new history. Otherwise the current history entry takes the
 * shapes, so undo still steps back through the local edits.
 */
export function replaceDrawingShapes(
	target: ReturnType<typeof createDrawingStore>,
	saved: EditorShape[],
	external: boolean,
): EditorShape[] {
	const currentShapes = target.getSnapshot().shapes;
	if (currentShapes === saved) return saved;
	const byId = new Map(currentShapes.map((shape) => [shape.id, shape]));
	let unchanged = saved.length === currentShapes.length;
	const merged = saved.map((shape, index) => {
		const previous = byId.get(shape.id);
		const kept = previous && sameShape(previous, shape) ? previous : shape;
		if (kept !== currentShapes[index]) unchanged = false;
		return kept;
	});
	const shapes = unchanged ? currentShapes : merged;
	if (shapes === currentShapes && !external) return shapes;
	target.transact((current) => {
		const next: DrawingSnapshot = {
			...current,
			shapes,
			history: external
				? historyOf<DrawingDocument>(
						{ shapes },
						shapes.length ? "Loaded drawing" : "Empty drawing",
					)
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
		};
		return [undefined, next];
	});
	return shapes;
}
