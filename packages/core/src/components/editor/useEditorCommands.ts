import {
	createSymbolFromSelectionEffect,
	redoEffect,
	removeShapesEffect,
	rotateShapesEffect,
	undoEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	canInspectSymbolChild,
	canSelectShape,
	canSelectSymbolChild,
	replaceSymbolChild,
	symbolChildren,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { type Dispatch, type SetStateAction, useCallback } from "react";
import type {
	DrawingCommand,
	EditorSession,
} from "#/components/editor/editorSession.ts";
import { symbolFileFromSymbol } from "#/components/editor/symbolFormat.ts";
import type {
	CanvasTool,
	useCanvasGestures,
} from "#/components/editor/useCanvasGestures.ts";
import type { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import {
	applySelectionEdit,
	type SelectionEdit,
} from "#/drawing/selection-edit.ts";
import { createSymbolFromShapes } from "#/drawing/symbols.ts";
import { measureText } from "#/engine/drawing/text.ts";

type Gestures = Pick<
	ReturnType<typeof useCanvasGestures>,
	| "getDrag"
	| "getWire"
	| "finishDrag"
	| "finishWire"
	| "canRotatePlacement"
	| "rotatePlacement"
>;

/**
 * The editor's selection and history commands. Each one first ends any
 * gesture in progress so the command applies to committed shapes.
 */
export function useEditorCommands({
	session,
	gestures: {
		getDrag,
		getWire,
		finishDrag,
		finishWire,
		canRotatePlacement,
		rotatePlacement,
	},
	tool,
	setTool,
	ready,
	selectedChildKey,
	symbolLibrary,
	setCreatingSymbol,
}: {
	session: EditorSession;
	gestures: Gestures;
	tool: CanvasTool;
	setTool: Dispatch<SetStateAction<CanvasTool>>;
	ready: boolean;
	selectedChildKey: string | null;
	symbolLibrary: ReturnType<typeof useSymbolLibrary>;
	setCreatingSymbol: Dispatch<SetStateAction<boolean>>;
}) {
	const editSelection = useCallback(
		(edit: SelectionEdit) => {
			const current = session.getState();
			const shapes = session.shapes();
			const selection = shapes.filter(
				(shape) =>
					current.selection.has(shape.id) &&
					canSelectShape(shape, current.allowLocked),
			);
			const symbol =
				selection.length === 1 && selection[0].kind === "symbol"
					? selection[0]
					: undefined;
			const selectedChild =
				symbol && current.childKey
					? symbolChildren(symbol).find(
							(child) =>
								child.key === current.childKey &&
								canInspectSymbolChild(symbol, child, current.allowLocked),
						)
					: undefined;
			const child =
				symbol &&
				selectedChild &&
				canSelectSymbolChild(symbol, selectedChild, current.allowLocked)
					? selectedChild
					: undefined;
			// A pin stays fixed to its symbol, so it takes no edits.
			if (selectedChild && !child) return;
			const result = applySelectionEdit(edit, {
				selection,
				child: symbol && child ? { symbol, child } : undefined,
				shapes,
				nextId: session.nextId(),
				allowLocked: current.allowLocked,
				measureText,
			});
			if (result?.error) session.setError(result.error);
			else if (result) session.replace(result.replacements, result.label);
			if (edit.kind === "lock" && child) session.selectChild(null);
		},
		[session],
	);

	const restoreHistory = useCallback(
		(program: DrawingCommand<unknown>) => {
			finishDrag(true);
			finishWire();
			if (tool === "symbol") setTool("select");
			session.restore(program);
		},
		[finishDrag, finishWire, tool, session, setTool],
	);
	const undo = useCallback(() => restoreHistory(undoEffect), [restoreHistory]);
	const redo = useCallback(() => restoreHistory(redoEffect), [restoreHistory]);
	const rotateItems = useCallback(
		(angle: number) => {
			if (!ready) return;
			if (canRotatePlacement) {
				rotatePlacement(angle);
				return;
			}
			if (!session.getState().selection.size) return;
			const active = getDrag();
			const childKey = active ? active.previousChild : selectedChildKey;
			finishDrag(true);
			finishWire();
			setTool("select");

			const { selection, allowLocked } = session.getState();
			const parent = session.shapes().find((shape) => selection.has(shape.id));
			if (childKey && parent?.kind === "symbol") {
				const child = symbolChildren(parent).find(
					(item) => item.key === childKey,
				);
				if (!child) return;
				// A pin stays fixed to its symbol, so rotating it turns the symbol.
				if (canSelectSymbolChild(parent, child, allowLocked)) {
					session.replace(
						[
							replaceSymbolChild(parent, childKey, {
								...child.shape,
								rotation: child.shape.rotation + angle,
							}),
						],
						"Rotate symbol child",
					);
					return;
				}
			}

			session.commit(rotateShapesEffect([...selection], angle));
		},
		[
			ready,
			canRotatePlacement,
			rotatePlacement,
			session,
			getDrag,
			selectedChildKey,
			finishDrag,
			finishWire,
			setTool,
		],
	);
	const removeSelected = useCallback(() => {
		finishDrag();
		if (getWire()) {
			finishWire();
			setTool("select");
		}
		session.commit(
			removeShapesEffect([...session.getState().selection]),
			new Set(),
		);
	}, [finishDrag, getWire, finishWire, session, setTool]);
	const createSelectionSymbol = async (
		name: string,
	): Promise<string | undefined> => {
		finishDrag();
		finishWire();
		const originalDrawing = session.drawing();
		const previousHistoryId = originalDrawing.history.currentId;
		const { selection } = session.getState();
		const ids = [...selection];
		const primitives = originalDrawing.shapes
			.filter((shape) => selection.has(shape.id))
			.filter((shape) => shape.kind !== "symbol");
		if (primitives.length !== ids.length || ids.length < 2)
			return "Select at least two drawing shapes to create a symbol.";
		try {
			const options: Parameters<typeof createSymbolFromShapes>[2] = {
				name,
				definitionId: `custom.${crypto.randomUUID()}`,
			};
			const draft = createSymbolFromShapes(
				session.nextId(),
				primitives,
				options,
			);
			const saveSymbol = symbolLibrary.prepareAddition(
				symbolFileFromSymbol(draft),
			);
			const library = await saveSymbol();
			options.library = library;
			if (session.drawing() !== originalDrawing)
				return "The drawing changed while saving. The symbol is in your library; select the shapes and try again.";
			const result = session.commit(
				createSymbolFromSelectionEffect(ids, options),
			);
			if (!result) return "Unable to create a symbol from this selection.";
			session.rememberSelection(previousHistoryId, ids);
			setTool("select");
			setCreatingSymbol(false);
		} catch (cause) {
			return errorMessage(cause, "Unable to save this symbol.");
		}
	};
	return {
		editSelection,
		restoreHistory,
		undo,
		redo,
		rotateItems,
		removeSelected,
		createSelectionSymbol,
	};
}
