import {
	dragTrackEnd,
	isBoardTrack,
} from "@ecad/drawing-core/board/track-drag.ts";
import type { TrackRouting } from "@ecad/drawing-core/board/track-router.ts";
import {
	drawShape,
	type EditorShape,
	moveShapes,
	moveSymbolChild,
	type ResizeHandle,
	resizeShape,
	resizeSymbolChild,
	snappedMoveDelta,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Bounds, Point } from "@ecad/drawing-core/drawing/types.ts";
import {
	applySelection,
	type SelectionMode,
} from "#/components/editor/selectionMode.ts";

/** A pointer drag on the editor canvas, from press to release. */
export interface CanvasDrag {
	pointerId: number;
	canvas: HTMLCanvasElement;
	start: Point | null;
	startScreen: Point;
	height?: number;
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
	pointer?: Point;
	wireStart?: Point;
	pressed?: ReadonlySet<number>;
	/** The latest move preview would route a wire through another net. */
	unsafe?: boolean;
	routing?: TrackRouting | null;
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
	point: Point | null,
	screen: Point,
	context: {
		shapes: readonly EditorShape[];
		allowLocked: boolean;
		cameraScale(): number;
		nextId(): number;
		routing?(): TrackRouting | undefined;
		inScreenBox(
			shape: EditorShape,
			box: Bounds,
			mode: CanvasMarquee["mode"],
		): boolean;
	},
): { moved: boolean; valid: boolean; effect: CanvasDragEffect } {
	const distance = Math.hypot(
		screen.x - drag.startScreen.x,
		screen.y - drag.startScreen.y,
	);
	const moved = drag.moved || distance >= 3;
	let valid = drag.valid;
	const result = (effect: CanvasDragEffect) => ({ moved, valid, effect });
	const none = () => result({ kind: "none" });
	if (drag.wireStart && !moved) return none();
	if (drag.mode === "duplicate") {
		if (!moved) return none();
		valid = true;
	}

	if (drag.mode === "marquee") {
		if (distance < 3)
			return result({
				kind: "marquee-cancel",
				selection:
					drag.pressed ??
					(drag.selectionMode === "replace"
						? new Set()
						: drag.previousSelection),
			});
		const mode = screen.x < drag.startScreen.x ? "crossing" : "window";
		const box = {
			minX: Math.min(drag.startScreen.x, screen.x),
			maxX: Math.max(drag.startScreen.x, screen.x),
			minY: Math.min(drag.startScreen.y, screen.y),
			maxY: Math.max(drag.startScreen.y, screen.y),
		};
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
					.filter((shape) => context.inScreenBox(shape, box, mode))
					.map((shape) => shape.id),
				drag.selectionMode,
			),
		});
	}
	const { start } = drag;
	if (!point || !start) return none();
	if (drag.gridStep > 0 && !moved) return none();
	const delta = { x: point.x - start.x, y: point.y - start.y };
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
		const original = drag.originals[0];
		const routing = isBoardTrack(original) ? context.routing?.() : undefined;
		return result({
			kind: "preview",
			replacements: routing
				? dragTrackEnd(
						original,
						drag.handle.xDirection > 0 ? 1 : 0,
						{ x: drag.handle.x + delta.x, y: drag.handle.y + delta.y },
						drag.initialShapes,
						context.nextId(),
						drag.gridStep,
						routing,
					)
				: [resizeShape(original, drag.handle, delta, drag.gridStep)],
			base: drag.initialShapes,
		});
	}
	if (drag.mode === "draw") {
		const original = drag.originals[0];
		if (original.kind === "symbol" || original.kind === "text") return none();
		const draft = {
			...drawShape(original.id, original.kind, start, point, drag.gridStep),
			lineWidth: original.lineWidth,
			...(original.layer ? { layer: original.layer } : {}),
			...("zone" in original && original.zone ? { zone: original.zone } : {}),
			...("net" in original && original.net ? { net: original.net } : {}),
		};
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
	if (drag.mode === "duplicate") {
		if (!moved) return none();
		const step = snappedMoveDelta(
			drag.anchorShape ?? drag.originals[0],
			delta,
			drag.gridStep,
		);
		return result({
			kind: "preview",
			movingShapeId: drag.anchorShape?.id ?? drag.originals[0].id,
			replacements: drag.originals.map((shape) => ({
				...shape,
				x: shape.x + step.x,
				y: shape.y + step.y,
			})),
			base: drag.initialShapes,
		});
	}
	if (drag.mode === "move") {
		if (!moved) return none();
		return result({
			kind: "preview",
			movingShapeId: drag.anchorShape?.id ?? drag.originals[0].id,
			replacements: moveShapes(
				drag.originals,
				delta,
				drag.gridStep,
				drag.anchorShape,
				drag.initialShapes,
				context.nextId(),
				context.allowLocked,
				context.routing?.(),
			),
			base: drag.initialShapes,
		});
	}
	return none();
}
