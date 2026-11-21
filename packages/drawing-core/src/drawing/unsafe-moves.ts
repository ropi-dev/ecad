import type { EditorShape } from "#/drawing/schema.ts";

const unsafeMoves = new WeakSet<readonly EditorShape[]>();

export const UNSAFE_MOVE_MESSAGE =
	"No route here avoids other nets, so the move was not applied.";

export function markUnsafeMove(result: readonly EditorShape[]) {
	unsafeMoves.add(result);
}

export const isUnsafeMove = (result: readonly EditorShape[]) =>
	unsafeMoves.has(result);
