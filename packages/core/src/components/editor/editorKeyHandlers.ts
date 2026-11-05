import {
	type EditorShape,
	type EditorSymbol,
	isUnsafeMove,
	moveShapes,
	moveSymbolChild,
	type symbolChildren,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { SCHEMATIC_STEP } from "@ecad/drawing-core/drawing/units.ts";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import {
	canvasKeyCommand,
	editorShortcut,
} from "#/components/editor/editorKeymap.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import type {
	CanvasTool,
	useCanvasGestures,
} from "#/components/editor/useCanvasGestures.ts";
import { isEditableTarget } from "#/lib/keyboard.ts";

export const UNSAFE_MOVE =
	"No wire route here avoids other nets, so the move was not applied.";

type Gestures = ReturnType<typeof useCanvasGestures>;

/** Editor-wide shortcuts: undo, redo, rotation and cancelling a placement. */
export function handleEditorShortcut(
	event: KeyboardEvent<HTMLElement>,
	{
		dialogOpen,
		ready,
		session,
		canRotatePlacement,
		clearPlacementPreview,
		setTool,
		rotateItems,
		undo,
		redo,
	}: {
		dialogOpen: boolean;
		ready: boolean;
		session: EditorSession;
		canRotatePlacement: boolean;
		clearPlacementPreview: Gestures["clearPlacementPreview"];
		setTool: Dispatch<SetStateAction<CanvasTool>>;
		rotateItems: (angle: number) => void;
		undo: () => void;
		redo: () => void;
	},
) {
	const shortcut = editorShortcut(event, {
		dialogOpen,
		placing: canRotatePlacement,
		editable: isEditableTarget(event),
		canRotate:
			ready && (canRotatePlacement || session.getState().selection.size > 0),
	});
	if (!shortcut) return;
	if (shortcut.kind === "cancel-placement") {
		clearPlacementPreview();
		setTool("select");
	} else if (shortcut.kind === "rotate") rotateItems(shortcut.angle);
	else if (shortcut.kind === "undo") undo();
	else redo();
	event.preventDefault();
	event.stopPropagation();
}

/** Keys handled while the canvas has focus: nudging, deleting and escaping. */
export function handleCanvasKeyDown(
	event: KeyboardEvent<HTMLElement>,
	{
		session,
		gestures: { getWire, getDrag, finishWire, finishDrag },
		setTool,
		selected,
		selectedSymbol,
		selectedChild,
		snapEnabled,
		gridStep,
		selectionSnapStep,
		allowLocked,
		removeSelected,
	}: {
		session: EditorSession;
		gestures: Pick<
			Gestures,
			"getWire" | "getDrag" | "finishWire" | "finishDrag"
		>;
		setTool: Dispatch<SetStateAction<CanvasTool>>;
		selected: EditorShape[];
		selectedSymbol: EditorSymbol | undefined;
		selectedChild: ReturnType<typeof symbolChildren>[number] | undefined;
		snapEnabled: boolean;
		gridStep: number;
		selectionSnapStep: number;
		allowLocked: boolean;
		removeSelected: () => void;
	},
) {
	if (!(event.target instanceof HTMLCanvasElement)) return;
	const command = canvasKeyCommand(event, {
		wiring: !!getWire(),
		dragging: !!getDrag(),
		hasSelection: selected.length > 0,
		childSelected: selectedChild !== undefined,
		childStep: snapEnabled
			? gridStep / (selectedChild?.shape.kind === "text" ? 10 : 1)
			: SCHEMATIC_STEP,
		selectionStep: selectionSnapStep || SCHEMATIC_STEP,
	});
	if (!command) return;
	switch (command.kind) {
		case "end-wire":
			finishWire();
			setTool("select");
			break;
		case "cancel-drag":
			finishDrag(true);
			break;
		case "deselect-child":
			session.selectChild(null);
			break;
		case "deselect":
			session.select(new Set());
			break;
		case "delete":
			finishDrag();
			removeSelected();
			break;
		case "move-child":
			if (selectedSymbol && selectedChild)
				session.replace(
					[
						moveSymbolChild(
							selectedSymbol,
							selectedChild.key,
							command.delta,
							0,
							allowLocked,
						),
					],
					"Move symbol child",
				);
			break;
		case "move-selection":
			if (command.endWire) {
				finishWire();
				setTool("select");
			}
			{
				const moved = moveShapes(
					selected,
					command.delta,
					selectionSnapStep,
					selected[0],
					session.shapes(),
					session.nextId(),
					allowLocked,
				);
				if (isUnsafeMove(moved)) session.setError(UNSAFE_MOVE);
				else session.replace(moved, "Move selection");
			}
			break;
	}
	event.preventDefault();
	event.stopPropagation();
}
