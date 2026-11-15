import { sameShape } from "@ecad/drawing-core/commands/drawing-equality.ts";
import {
	type createDrawingStore,
	type DrawingDocument,
	type DrawingSnapshot,
	drawingDocument,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import { historyOf } from "@ecad/drawing-core/drawing/history.ts";
import {
	canonicalShapePages,
	type DrawingPage,
	savedPages,
} from "@ecad/drawing-core/drawing/pages.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { SheetSettings } from "@ecad/drawing-core/drawing/sheet.ts";

/**
 * Replaces a drawing store's shapes with saved shapes without recording an
 * edit. External shapes did not come from this store's commands, so they
 * start a new history. Otherwise the current history entry takes the
 * shapes, so undo still steps back through the local edits.
 */
export function replaceDrawingShapes(
	target: ReturnType<typeof createDrawingStore>,
	loaded: EditorShape[],
	external: boolean,
	settings: {
		pages?: readonly DrawingPage[];
		sheet?: SheetSettings;
	} = {},
): EditorShape[] {
	const current = target.getSnapshot();
	const currentShapes = current.shapes;
	const pages = savedPages(settings.pages);
	const saved = canonicalShapePages(loaded, pages);
	const { shapes: _shapes, ...loadedRest } = drawingDocument(
		saved,
		pages,
		settings.sheet,
	);
	const { shapes: _current, ...currentRest } = drawingDocument(
		currentShapes,
		current.pages,
		current.sheet,
	);
	const samePages = JSON.stringify(loadedRest) === JSON.stringify(currentRest);
	if (currentShapes === saved && samePages) return saved;
	const byId = new Map(currentShapes.map((shape) => [shape.id, shape]));
	let unchanged = saved.length === currentShapes.length;
	const merged = saved.map((shape, index) => {
		const previous = byId.get(shape.id);
		const kept = previous && sameShape(previous, shape) ? previous : shape;
		if (kept !== currentShapes[index]) unchanged = false;
		return kept;
	});
	// A page or sheet change alone still publishes new shapes, as commits do.
	const shapes = unchanged && samePages ? currentShapes : merged;
	if (shapes === currentShapes && !external) return shapes;
	target.transact((current) => {
		const { pages: _pages, sheet: _sheet, ...rest } = current;
		const document: DrawingDocument = { shapes, ...loadedRest };
		const next: DrawingSnapshot = {
			...rest,
			...document,
			history: external
				? historyOf<DrawingDocument>(
						document,
						shapes.length ? "Loaded drawing" : "Empty drawing",
					)
				: {
						...current.history,
						nodes: {
							...current.history.nodes,
							[current.history.currentId]: {
								...current.history.nodes[current.history.currentId],
								state: document,
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
