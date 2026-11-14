import { isNetLabel } from "@ecad/drawing-core/drawing/named-nets.ts";
import {
	canInspectSymbolChild,
	canSelectShape,
	canSelectSymbolChild,
	type EditorShape,
	mergeBounds,
	resizeHandles,
	shapeBounds,
	symbolChildren,
	symbolChildWorld,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { useMemo } from "react";
import type { CanvasTool } from "#/components/editor/useCanvasGestures.ts";

/**
 * Derives the selectable shapes, the selected symbol child, its resize handles
 * and the keyboard snapping step from the editor session's selection.
 */
export function useEditorSelection({
	shapes,
	selectedIds,
	selectedChildKey,
	allowLocked,
	tool,
	gridStep,
}: {
	shapes: EditorShape[];
	selectedIds: ReadonlySet<number>;
	selectedChildKey: string | null;
	allowLocked: boolean;
	tool: CanvasTool;
	gridStep: number;
}) {
	const selected = useMemo(
		() =>
			shapes.filter(
				(shape) =>
					selectedIds.has(shape.id) && canSelectShape(shape, allowLocked),
			),
		[shapes, selectedIds, allowLocked],
	);
	const selectedSymbol =
		selected.length === 1 && selected[0].kind === "symbol"
			? selected[0]
			: undefined;
	const selectedChild = useMemo(
		() =>
			selectedSymbol && selectedChildKey
				? symbolChildren(selectedSymbol).find(
						(child) =>
							child.key === selectedChildKey &&
							canInspectSymbolChild(selectedSymbol, child, allowLocked),
					)
				: undefined,
		[selectedSymbol, selectedChildKey, allowLocked],
	);
	// A pin is selectable to show its attributes but stays fixed to its symbol.
	const selectedChildFixed =
		!!selectedSymbol &&
		!!selectedChild &&
		!canSelectSymbolChild(selectedSymbol, selectedChild, allowLocked);

	const selectionLocked = selectedChild
		? selectedChild.shape.locked === true
		: selected.length > 0 && selected.every((shape) => shape.locked === true);

	const selectionSnapStep =
		selected.length > 0 &&
		selected.every((shape) => shape.kind === "text" && !isNetLabel(shape))
			? gridStep / 10
			: gridStep;
	const handles = useMemo(
		() =>
			tool === "select"
				? selectedSymbol && selectedChild
					? selectedChildFixed
						? []
						: resizeHandles(
								symbolChildWorld(selectedSymbol, selectedChild.shape),
							).map((handle) => ({
								shape: selectedSymbol,
								handle,
								childKey: selectedChild.key,
							}))
					: selected.flatMap((shape) =>
							resizeHandles(shape).map((handle) => ({
								shape,
								handle,
								childKey: undefined,
							})),
						)
				: [],
		[tool, selectedSymbol, selectedChild, selectedChildFixed, selected],
	);
	return {
		selected,
		selectedSymbol,
		selectedChild,
		selectedChildFixed,
		selectionLocked,
		selectionSnapStep,
		handles,
	};
}

/** The world bounds that F6 fits: the selected symbol child or the selection. */
export function selectionFitBounds(
	selected: EditorShape[],
	selectedSymbol: ReturnType<typeof useEditorSelection>["selectedSymbol"],
	selectedChild: ReturnType<typeof useEditorSelection>["selectedChild"],
) {
	const targets =
		selectedSymbol && selectedChild
			? [symbolChildWorld(selectedSymbol, selectedChild.shape)]
			: selected;
	return targets.length ? mergeBounds(targets.map(shapeBounds)) : null;
}
