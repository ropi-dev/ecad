import type { Point } from "#/drawing/types.ts";
import {
	arrowDelta,
	handleHistoryKeyDown,
	isArrowKey,
} from "#/lib/keyboard.ts";

export interface EditorKey {
	readonly key: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}

export type EditorShortcut =
	| { readonly kind: "cancel-placement" }
	| { readonly kind: "rotate"; readonly angle: number }
	| { readonly kind: "undo" }
	| { readonly kind: "redo" };

/**
 * Shortcuts that work anywhere in the editor. `undefined` leaves the key to
 * the page.
 */
export function editorShortcut(
	event: EditorKey,
	context: {
		/** The Create symbol dialog takes every key. */
		readonly dialogOpen: boolean;
		readonly placingSymbol: boolean;
		/** The key goes to a text field or another control. */
		readonly editable: boolean;
		readonly canRotate: boolean;
	},
): EditorShortcut | undefined {
	if (context.dialogOpen) return undefined;
	if (event.key === "Escape" && context.placingSymbol)
		return { kind: "cancel-placement" };
	if (event.altKey || context.editable) return undefined;
	if (!(event.ctrlKey || event.metaKey)) {
		if (event.key.toLowerCase() !== "r" || !context.canRotate) return undefined;
		return { kind: "rotate", angle: ((event.shiftKey ? -1 : 1) * Math.PI) / 2 };
	}
	let shortcut: EditorShortcut | undefined;
	handleHistoryKeyDown(
		{
			key: event.key,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			altKey: event.altKey,
			shiftKey: event.shiftKey,
			preventDefault() {},
		},
		{
			undo: () => {
				shortcut = { kind: "undo" };
			},
			redo: () => {
				shortcut = { kind: "redo" };
			},
		},
	);
	return shortcut;
}

export type CanvasKeyCommand =
	| { readonly kind: "end-wire" }
	| { readonly kind: "cancel-drag" }
	| { readonly kind: "deselect-child" }
	| { readonly kind: "deselect" }
	| { readonly kind: "delete" }
	| { readonly kind: "move-child"; readonly delta: Point }
	| {
			readonly kind: "move-selection";
			readonly delta: Point;
			/** An open wire chain ends before the selection moves. */
			readonly endWire: boolean;
	  }
	/** Arrow keys during a drag do nothing, but the page must not scroll. */
	| { readonly kind: "ignore" };

/** Keys pressed while the drawing canvas has focus. */
export function canvasKeyCommand(
	event: EditorKey,
	context: {
		readonly wiring: boolean;
		readonly dragging: boolean;
		readonly hasSelection: boolean;
		readonly childSelected: boolean;
		/** Arrow key distance for a selected symbol child. */
		readonly childStep: number;
		/** Arrow key distance for the selection. */
		readonly selectionStep: number;
	},
): CanvasKeyCommand | undefined {
	const { key } = event;
	if (context.wiring && (key === "Escape" || key === "Enter"))
		return { kind: "end-wire" };
	if (key === "Escape")
		return context.dragging
			? { kind: "cancel-drag" }
			: context.childSelected
				? { kind: "deselect-child" }
				: { kind: "deselect" };
	if (context.hasSelection && (key === "Delete" || key === "Backspace"))
		return { kind: "delete" };
	if (!isArrowKey(key)) return undefined;
	const multiplier = event.shiftKey ? 10 : 1;
	if (context.childSelected && !context.dragging)
		return {
			kind: "move-child",
			delta: arrowDelta(key, context.childStep * multiplier, "up"),
		};
	if (!context.hasSelection) return undefined;
	if (context.dragging) return { kind: "ignore" };
	return {
		kind: "move-selection",
		delta: arrowDelta(key, context.selectionStep * multiplier, "up"),
		endWire: context.wiring,
	};
}
