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
import type { Accessor } from "solid-js";
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
	editsFixedPin,
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
export function useEditorCommands(
	options: Accessor<{
		session: EditorSession;
		gestures: Gestures;
		tool: CanvasTool;
		setTool: (tool: CanvasTool) => void;
		ready: boolean;
		selectedChildKey: string | null;
		symbolLibrary: ReturnType<typeof useSymbolLibrary>;
		setCreatingSymbol: (open: boolean) => void;
	}>,
) {
	const editSelection = (edit: SelectionEdit) => {
		const { session } = options();
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
			(canSelectSymbolChild(symbol, selectedChild, current.allowLocked) ||
				editsFixedPin(edit))
				? selectedChild
				: undefined;
		// A pin stays fixed to its symbol, so it takes no other edits.
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
	};

	const restoreHistory = (program: DrawingCommand<unknown>) => {
		const { session, gestures, tool, setTool } = options();
		gestures.finishDrag(true);
		gestures.finishWire();
		if (tool === "symbol") setTool("select");
		session.restore(program);
	};
	const undo = () => restoreHistory(undoEffect);
	const redo = () => restoreHistory(redoEffect);
	const rotateItems = (angle: number) => {
		const { session, gestures, ready, selectedChildKey, setTool } = options();
		if (!ready) return;
		if (gestures.canRotatePlacement) {
			gestures.rotatePlacement(angle);
			return;
		}
		if (!session.getState().selection.size) return;
		const active = gestures.getDrag();
		const childKey = active ? active.previousChild : selectedChildKey;
		gestures.finishDrag(true);
		gestures.finishWire();
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
	};
	const removeSelected = () => {
		const { session, gestures, setTool } = options();
		gestures.finishDrag();
		if (gestures.getWire()) {
			gestures.finishWire();
			setTool("select");
		}
		session.commit(
			removeShapesEffect([...session.getState().selection]),
			new Set(),
		);
	};
	const createSelectionSymbol = async (
		name: string,
	): Promise<string | undefined> => {
		const { session, gestures, symbolLibrary, setTool, setCreatingSymbol } =
			options();
		gestures.finishDrag();
		gestures.finishWire();
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
