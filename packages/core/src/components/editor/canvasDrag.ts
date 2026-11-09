import {
	containsSelection,
	drawShape,
	type EditorShape,
	intersectsSelection,
	moveShapes,
	moveSymbolChild,
	type ResizeHandle,
	resizeShape,
	resizeSymbolChild,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	applySelection,
	type SelectionMode,
} from "#/components/editor/selectionMode.ts";

/** A pointer drag on the editor canvas, from press to release. */
export interface CanvasDrag {
	pointerId: number;
	canvas: HTMLCanvasElement;
	start: Point;
	startScreen: Point;
	previousSelection: ReadonlySet<number>;
	mode: "move" | "duplicate" | "marquee" | "draw" | "resize" | "symbol-child";
	childKey?: string;
	previousChild: string | null;
	handle?: ResizeHandle;
	anchorShape?: EditorShape;
	gridStep: number;
	moved: boolean;
	originals: EditorShape[];
	initialShapes: EditorShape[];
	created: boolean;
	valid: boolean;
	selectionMode: SelectionMode;
	pointer?: { point: Point; screen: Point };
	wireStart?: Point;
	/** The latest move preview would route a wire through another net. */
	unsafe?: boolean;
}

export interface CanvasMarquee {
	start: Point;
	end: Point;
	mode: "window" | "crossing";
	selection: SelectionMode;
}

/** What one pointer move does to the drawing while a drag is active. */
export type CanvasDragEffect =
	| { kind: "none" }
	/** Show these shapes in place of their originals, adding new IDs. */
	| {
			kind: "preview";
			replacements: EditorShape[];
			/** The shapes to replace; the session's current shapes when omitted. */
			base?: EditorShape[];
			movingShapeId?: number;
	  }
	/** A marquee drag back under the click threshold: restore the selection. */
	| { kind: "marquee-cancel"; selection: ReadonlySet<number> }
	| {
			kind: "marquee";
			marquee: CanvasMarquee;
			selection: ReadonlySet<number>;
	  };

/**
 * Advances a canvas drag to a new pointer position. `point` is in world
 * coordinates and `screen` in canvas pixels. Returns the drag's updated
 * `moved` and `valid` flags with the preview or selection to show. Reading
 * the camera scale and the next shape ID is deferred to the modes that need
 * them.
 */
export function canvasDragStep(
	drag: CanvasDrag,
	point: Point,
	screen: Point,
	context: {
		shapes: readonly EditorShape[];
		allowLocked: boolean;
		cameraScale(): number;
		nextId(): number;
	},
): { moved: boolean; valid: boolean; effect: CanvasDragEffect } {
	const moved =
		drag.moved ||
		Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) >=
			3;
	let valid = drag.valid;
	const result = (effect: CanvasDragEffect) => ({ moved, valid, effect });
	const none = () => result({ kind: "none" });
	if (drag.wireStart && !moved) return none();
	if (drag.mode === "duplicate") {
		if (!moved) return none();
		valid = true;
	}

	if (drag.gridStep > 0 && !moved && drag.mode !== "marquee") return none();
	const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y };
	if (drag.mode === "symbol-child") {
		const original = drag.originals[0];
		if (!moved || original.kind !== "symbol" || drag.childKey === undefined)
			return none();
		return result({
			kind: "preview",
			replacements: [
				drag.handle
					? resizeSymbolChild(
							original,
							drag.childKey,
							drag.handle,
							delta,
							drag.gridStep,
							context.allowLocked,
						)
					: moveSymbolChild(
							original,
							drag.childKey,
							delta,
							drag.gridStep,
							context.allowLocked,
						),
			],
			base: drag.initialShapes,
		});
	}
	if (drag.mode === "resize" && drag.handle) {
		return result({
			kind: "preview",
			replacements: [
				resizeShape(drag.originals[0], drag.handle, delta, drag.gridStep),
			],
			base: drag.initialShapes,
		});
	}
	if (drag.mode === "draw") {
		const original = drag.originals[0];
		if (original.kind === "symbol" || original.kind === "text") return none();
		const draft = drawShape(
			original.id,
			original.kind,
			drag.start,
			point,
			drag.gridStep,
		);
		const scale = context.cameraScale();
		valid =
			draft.width > 0 &&
			draft.height > 0 &&
			(draft.kind === "line"
				? draft.width
				: Math.min(draft.width, draft.height)) *
				scale >=
				3;
		return result({
			kind: "preview",
			replacements: [draft],
			movingShapeId: draft.id,
		});
	}
	if (drag.mode === "move" || drag.mode === "duplicate") {
		if (!moved) return none();
		return result({
			kind: "preview",
			movingShapeId: drag.anchorShape?.id ?? drag.originals[0].id,
			replacements: moveShapes(
				drag.originals,
				delta,
				drag.gridStep,
				drag.anchorShape,
				drag.mode === "duplicate" ? drag.originals : drag.initialShapes,
				context.nextId(),
				context.allowLocked,
			),
			base: drag.initialShapes,
		});
	}
	if (
		Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) < 3
	)
		return result({
			kind: "marquee-cancel",
			selection:
				drag.selectionMode === "replace" ? new Set() : drag.previousSelection,
		});
	const mode = screen.x < drag.startScreen.x ? "crossing" : "window";
	const bounds = {
		minX: Math.min(drag.start.x, point.x),
		maxX: Math.max(drag.start.x, point.x),
		minY: Math.min(drag.start.y, point.y),
		maxY: Math.max(drag.start.y, point.y),
	};
	const matches = mode === "window" ? containsSelection : intersectsSelection;
	return result({
		kind: "marquee",
		marquee: {
			start: drag.startScreen,
			end: screen,
			mode,
			selection: drag.selectionMode,
		},
		selection: applySelection(
			drag.previousSelection,
			context.shapes
				.filter((shape) => matches(shape, bounds))
				.map((shape) => shape.id),
			drag.selectionMode,
		),
	});
}
