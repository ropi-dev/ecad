import { isNetLabel } from "@ecad/drawing-core/drawing/named-nets.ts";
import {
	canInspectSymbolChild,
	canSelectShape,
	canSelectSymbolChild,
	type EditorShape,
	type EditorSymbol,
	mergeBounds,
	resizeHandles,
	shapeBounds,
	symbolChildren,
	symbolChildWorld,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { type Accessor, createMemo } from "solid-js";
import type { CanvasTool } from "#/components/editor/useCanvasGestures.ts";

const sameShapes = (a: readonly EditorShape[], b: readonly EditorShape[]) =>
	a.length === b.length && a.every((shape, index) => shape === b[index]);

export type SymbolChild = ReturnType<typeof symbolChildren>[number];

/**
 * Derives the selectable shapes, the selected symbol child, its resize handles
 * and the keyboard snapping step from the editor session's selection.
 */
export function useEditorSelection(
	options: Accessor<{
		shapes: EditorShape[];
		selectedIds: ReadonlySet<number>;
		selectedChildKey: string | null;
		allowLocked: boolean;
		tool: CanvasTool;
		gridStep: number;
	}>,
) {
	const shapes = createMemo(() => options().shapes);
	const selectedIds = createMemo(() => options().selectedIds);
	const selectedChildKey = createMemo(() => options().selectedChildKey);
	const allowLocked = createMemo(() => options().allowLocked);
	const tool = createMemo(() => options().tool);
	const gridStep = createMemo(() => options().gridStep);
	const selected = createMemo(
		() => {
			const ids = selectedIds();
			const locked = allowLocked();
			return shapes().filter(
				(shape) => ids.has(shape.id) && canSelectShape(shape, locked),
			);
		},
		{ equals: sameShapes },
	);
	const selectedSymbol = createMemo((): EditorSymbol | undefined => {
		const shapes = selected();
		return shapes.length === 1 && shapes[0].kind === "symbol"
			? shapes[0]
			: undefined;
	});
	const selectedChild = createMemo((): SymbolChild | undefined => {
		const symbol = selectedSymbol();
		const key = selectedChildKey();
		const locked = allowLocked();
		return symbol && key
			? symbolChildren(symbol).find(
					(child) =>
						child.key === key && canInspectSymbolChild(symbol, child, locked),
				)
			: undefined;
	});
	// A pin is selectable to show its attributes but stays fixed to its symbol.
	const selectedChildFixed = createMemo(() => {
		const symbol = selectedSymbol();
		const child = selectedChild();
		return (
			!!symbol && !!child && !canSelectSymbolChild(symbol, child, allowLocked())
		);
	});
	const selectionLocked = createMemo(() => {
		const child = selectedChild();
		if (child) return child.shape.locked === true;
		const shapes = selected();
		return shapes.length > 0 && shapes.every((shape) => shape.locked === true);
	});
	const textOnly = createMemo(() => {
		const shapes = selected();
		return (
			shapes.length > 0 &&
			shapes.every((shape) => shape.kind === "text" && !isNetLabel(shape))
		);
	});
	const selectionSnapStep = createMemo(() =>
		textOnly() ? gridStep() / 10 : gridStep(),
	);
	const handles = createMemo(() => {
		if (tool() !== "select") return [];
		const symbol = selectedSymbol();
		const child = selectedChild();
		if (symbol && child)
			return selectedChildFixed()
				? []
				: resizeHandles(symbolChildWorld(symbol, child.shape)).map(
						(handle) => ({ shape: symbol, handle, childKey: child.key }),
					);
		return selected().flatMap((shape) =>
			resizeHandles(shape).map((handle) => ({
				shape,
				handle,
				childKey: undefined,
			})),
		);
	});
	return {
		get selected() {
			return selected();
		},
		get selectedSymbol() {
			return selectedSymbol();
		},
		get selectedChild() {
			return selectedChild();
		},
		get selectedChildFixed() {
			return selectedChildFixed();
		},
		get selectionLocked() {
			return selectionLocked();
		},
		get selectionSnapStep() {
			return selectionSnapStep();
		},
		get handles() {
			return handles();
		},
	};
}

/** The world bounds that F6 fits: the selected symbol child or the selection. */
export function selectionFitBounds(
	selected: EditorShape[],
	selectedSymbol: EditorSymbol | undefined,
	selectedChild: SymbolChild | undefined,
) {
	const targets =
		selectedSymbol && selectedChild
			? [symbolChildWorld(selectedSymbol, selectedChild.shape)]
			: selected;
	return targets.length ? mergeBounds(targets.map(shapeBounds)) : null;
}
