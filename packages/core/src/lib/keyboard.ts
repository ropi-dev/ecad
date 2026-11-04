import type { Point } from "#/drawing/types.ts";

/**
 * Whether a key event comes from a control the user is typing in, so editor
 * shortcuts should leave the key to it.
 *
 * `isContentEditable` covers every editing host (`contenteditable`,
 * `contenteditable="true"` and `"plaintext-only"`) and the elements inside it.
 * An attribute selector such as `[contenteditable=true]` misses the bare
 * attribute and nested elements. Every `input`, `textarea` and `select` counts,
 * including checkboxes, radios and sliders, because they handle Space, arrows
 * or clipboard keys themselves.
 */
export function isEditableTarget({
	target,
}: {
	readonly target: EventTarget | null;
}) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target.closest("input, textarea, select") !== null)
	);
}

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

const arrowKeys: ReadonlySet<string> = new Set<ArrowKey>([
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"ArrowDown",
]);

export const isArrowKey = (key: string): key is ArrowKey => arrowKeys.has(key);

/**
 * Moves `step` units in the arrow key's direction, or returns `undefined` for
 * any other key. `yAxis` is the direction of positive y: `"down"` in screen and
 * SVG coordinates, `"up"` in drawing coordinates.
 */
export function arrowDelta(
	key: ArrowKey,
	step: number,
	yAxis?: "down" | "up",
): Point;
export function arrowDelta(
	key: string,
	step: number,
	yAxis?: "down" | "up",
): Point | undefined;
export function arrowDelta(
	key: string,
	step: number,
	yAxis: "down" | "up" = "down",
): Point | undefined {
	const down = yAxis === "down" ? step : -step;
	switch (key) {
		case "ArrowLeft":
			return { x: -step, y: 0 };
		case "ArrowRight":
			return { x: step, y: 0 };
		case "ArrowUp":
			return { x: 0, y: -down };
		case "ArrowDown":
			return { x: 0, y: down };
		default:
			return undefined;
	}
}

interface HistoryKeyEvent {
	readonly key: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
	preventDefault(): void;
}

/**
 * Undoes on Ctrl/Cmd+Z and redoes on Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y. Alt
 * combinations are left alone, because AltGr reports Ctrl+Alt and types
 * characters on many keyboard layouts. Returns whether the key was handled.
 */
export function handleHistoryKeyDown(
	event: HistoryKeyEvent,
	history: { undo(): void; redo(): void },
) {
	if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
	const key = event.key.toLowerCase();
	if (key === "z" && event.shiftKey) history.redo();
	else if (key === "z") history.undo();
	else if (key === "y" && !event.shiftKey) history.redo();
	else return false;
	event.preventDefault();
	return true;
}
