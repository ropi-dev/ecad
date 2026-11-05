import { isNetLabel } from "@ecad/drawing-core/drawing/named-nets.ts";
import {
	canSelectShape,
	canSelectSymbolChild,
	type EditorShape,
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
	snapEnabled,
	gridStep,
}: {
	shapes: EditorShape[];
	selectedIds: ReadonlySet<number>;
	selectedChildKey: string | null;
	allowLocked: boolean;
	tool: CanvasTool;
	snapEnabled: boolean;
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
							canSelectSymbolChild(selectedSymbol, child, allowLocked),
					)
				: undefined,
		[selectedSymbol, selectedChildKey, allowLocked],
	);

	const selectionLocked = selectedChild
		? selectedChild.shape.locked === true
		: selected.length > 0 && selected.every((shape) => shape.locked === true);

	const selectionSnapStep = snapEnabled
		? selected.length > 0 &&
			selected.every((shape) => shape.kind === "text" && !isNetLabel(shape))
			? gridStep / 10
			: gridStep
		: 0;
	const handles = useMemo(
		() =>
			tool === "select"
				? selectedSymbol && selectedChild
					? resizeHandles(
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
		[tool, selectedSymbol, selectedChild, selected],
	);
	return {
		selected,
		selectedSymbol,
		selectedChild,
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
	if (!targets.length) return null;
	const bounds = targets.map(shapeBounds);
	return {
		minX: Math.min(...bounds.map((box) => box.minX)),
		minY: Math.min(...bounds.map((box) => box.minY)),
		maxX: Math.max(...bounds.map((box) => box.maxX)),
		maxY: Math.max(...bounds.map((box) => box.maxY)),
	};
}
