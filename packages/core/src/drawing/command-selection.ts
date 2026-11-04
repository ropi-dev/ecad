import type { CommandResult } from "#/commands/drawing-commands.ts";
import type { EditorShape } from "#/drawing/shapes.ts";

/**
 * The shapes to select after placing new ones. A route's last leg can overlap
 * an existing wire, and normalization splits that wire. Its pieces still
 * belong to the existing wire, even when one of them receives the new leg's
 * ID, so they stay unselected.
 */
export function placedSelection(
	previous: readonly EditorShape[],
	result: Pick<CommandResult, "ids" | "idsBySource">,
): Set<number> {
	const splitExistingWires = new Set(
		previous.flatMap((shape) => {
			const pieces = result.idsBySource.get(shape.id) ?? [];
			return shape.kind === "wire" && pieces.length > 1 ? pieces : [];
		}),
	);
	return new Set(result.ids.filter((id) => !splitExistingWires.has(id)));
}
