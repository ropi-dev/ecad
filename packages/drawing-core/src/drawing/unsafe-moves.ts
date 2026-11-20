import type { EditorShape } from "#/drawing/schema.ts";

const unsafeMoves = new WeakSet<readonly EditorShape[]>();

export const UNSAFE_MOVE_MESSAGE =
	"No route here avoids other nets, so the move was not applied.";

export function markUnsafeMove(result: readonly EditorShape[]) {
	unsafeMoves.add(result);
}

/**
 * Whether a move result routes a wire or track through another net because
 * no safe route was found. Previews may show it; committing it would join the
 * nets.
 */
export const isUnsafeMove = (result: readonly EditorShape[]) =>
	unsafeMoves.has(result);
