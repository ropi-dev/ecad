import { type ClipboardEvent as ReactClipboardEvent, useRef } from "react";
import { removeShapesEffect } from "#/commands/drawing-commands.ts";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import {
	drawingClipboardType,
	parseSelection,
	pasteSelection,
	selectionFileText,
	selectionPasteError,
	serializeSelection,
} from "#/drawing/clipboard.ts";
import {
	clipboardSelectionText,
	writeSelectionClipboard,
} from "#/drawing/clipboard-browser.ts";
import { canSelectShape, type EditorShape } from "#/drawing/shapes.ts";
import { errorMessage } from "#/lib/error-message.ts";
import { isEditableTarget } from "#/lib/keyboard.ts";

export interface DrawingClipboardOptions {
	session: EditorSession;

	enabled: () => boolean;

	target: "symbol" | "drawing";

	pasteStep: number;

	beforePaste: () => void;
}

export function useDrawingClipboard({
	session,
	enabled,
	target,
	pasteStep,
	beforePaste,
}: DrawingClipboardOptions) {
	const lastPaste = useRef({ text: "", count: 0 });
	const available = (event: ReactClipboardEvent) => {
		const element = event.target;
		return (
			enabled() &&
			!isEditableTarget(event) &&
			!(element instanceof HTMLElement && element.closest("[role=dialog]"))
		);
	};
	const copy = (event: ReactClipboardEvent, cut: boolean) => {
		if (!available(event)) return;
		const { selection, allowLocked } = session.getState();
		const source = session
			.shapes()
			.filter(
				(shape) =>
					selection.has(shape.id) && canSelectShape(shape, allowLocked),
			);
		if (!source.length) return;
		const text = serializeSelection(source);
		const captured = parseSelection(text, { legacy: true });
		if (!captured) {
			session.setError(
				"The selection is too large or contains unavailable symbol geometry.",
			);
			return;
		}
		try {
			const file = selectionFileText(captured);
			event.clipboardData.setData("text/plain", file);
			event.clipboardData.setData(drawingClipboardType, text);
			session.setError("");
			void writeSelectionClipboard(captured, text, file)?.catch(() => {
				session.setError(
					(current) =>
						current ||
						"Image formats could not be copied. Editable data and save-file text are still available.",
				);
			});
		} catch {
			session.setError("Unable to copy the selection to the clipboard.");
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		lastPaste.current = { text, count: 0 };
		if (cut)
			session.commit(
				removeShapesEffect(
					source.map((shape) => shape.id),
					"Cut selection",
				),
				new Set(),
			);
	};
	const paste = (event: ReactClipboardEvent) => {
		if (!available(event)) return;
		const text = clipboardSelectionText(event.clipboardData);
		const source = parseSelection(text);
		if (!source) {
			const error = selectionPasteError(text);
			if (!error) return;
			event.preventDefault();
			event.stopPropagation();
			session.setError(error);
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const count =
			lastPaste.current.text === text ? lastPaste.current.count + 1 : 1;
		const step = pasteStep * count;
		let pasted: EditorShape[];
		try {
			pasted = pasteSelection(
				source,
				session.shapes(),
				session.nextId(),
				{ x: step, y: -step },
				target,
			);
		} catch (cause) {
			session.setError(
				errorMessage(
					cause,
					"This selection cannot be pasted into a reusable symbol.",
				),
			);
			return;
		}
		beforePaste();
		session.place(pasted, "Paste selection");
		lastPaste.current = { text, count };
	};
	return {
		onCopy: (event: ReactClipboardEvent) => copy(event, false),
		onCut: (event: ReactClipboardEvent) => copy(event, true),
		onPaste: paste,
	};
}
