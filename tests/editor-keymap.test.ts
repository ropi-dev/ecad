import assert from "node:assert/strict";
import { test } from "node:test";
import {
	canvasKeyCommand,
	type EditorKey,
	editorShortcut,
} from "#/components/editor/editorKeymap.ts";

const key = (value: string, modifiers: Partial<EditorKey> = {}): EditorKey => ({
	key: value,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...modifiers,
});
const shortcutContext = {
	dialogOpen: false,
	placingSymbol: false,
	editable: false,
	canRotate: true,
};
const canvasContext = {
	wiring: false,
	dragging: false,
	hasSelection: true,
	childSelected: false,
	childStep: 2,
	selectionStep: 5,
};

test("R rotates counterclockwise and Shift+R clockwise when something is selected", () => {
	assert.deepEqual(editorShortcut(key("r"), shortcutContext), { kind: "rotate", angle: Math.PI / 2 });
	assert.deepEqual(editorShortcut(key("R", { shiftKey: true }), shortcutContext), { kind: "rotate", angle: -Math.PI / 2 });
	assert.equal(editorShortcut(key("r"), { ...shortcutContext, canRotate: false }), undefined);
	assert.equal(editorShortcut(key("x"), shortcutContext), undefined);
});

test("history shortcuts use Ctrl or Cmd and leave AltGr combinations alone", () => {
	assert.deepEqual(editorShortcut(key("z", { ctrlKey: true }), shortcutContext), { kind: "undo" });
	assert.deepEqual(editorShortcut(key("Z", { metaKey: true, shiftKey: true }), shortcutContext), { kind: "redo" });
	assert.deepEqual(editorShortcut(key("y", { ctrlKey: true }), shortcutContext), { kind: "redo" });
	assert.equal(editorShortcut(key("y", { ctrlKey: true, shiftKey: true }), shortcutContext), undefined);
	assert.equal(editorShortcut(key("z", { ctrlKey: true, altKey: true }), shortcutContext), undefined);
	assert.equal(editorShortcut(key("r", { ctrlKey: true }), shortcutContext), undefined, "Ctrl+R stays with the browser");
});

test("Escape cancels symbol placement, even from a text field, but never in the dialog", () => {
	assert.deepEqual(editorShortcut(key("Escape"), { ...shortcutContext, placingSymbol: true, editable: true }), { kind: "cancel-placement" });
	assert.equal(editorShortcut(key("Escape"), shortcutContext), undefined);
	assert.equal(editorShortcut(key("Escape"), { ...shortcutContext, placingSymbol: true, dialogOpen: true }), undefined);
	assert.equal(editorShortcut(key("z", { ctrlKey: true }), { ...shortcutContext, dialogOpen: true }), undefined);
});

test("text fields keep their keys", () => {
	for (const event of [key("r"), key("z", { ctrlKey: true }), key("y", { metaKey: true })])
		assert.equal(editorShortcut(event, { ...shortcutContext, editable: true }), undefined);
	assert.equal(editorShortcut(key("r", { altKey: true }), shortcutContext), undefined);
});

test("Escape and Enter end a wire chain before anything else", () => {
	for (const value of ["Escape", "Enter"])
		assert.deepEqual(canvasKeyCommand(key(value), { ...canvasContext, wiring: true, dragging: true }), { kind: "end-wire" });
	assert.equal(canvasKeyCommand(key("Enter"), canvasContext), undefined);
});

test("Escape cancels a drag, then deselects the child, then the selection", () => {
	assert.deepEqual(canvasKeyCommand(key("Escape"), { ...canvasContext, dragging: true, childSelected: true }), { kind: "cancel-drag" });
	assert.deepEqual(canvasKeyCommand(key("Escape"), { ...canvasContext, childSelected: true }), { kind: "deselect-child" });
	assert.deepEqual(canvasKeyCommand(key("Escape"), canvasContext), { kind: "deselect" });
	assert.deepEqual(canvasKeyCommand(key("Escape"), { ...canvasContext, hasSelection: false }), { kind: "deselect" });
});

test("Delete and Backspace remove a selection", () => {
	assert.deepEqual(canvasKeyCommand(key("Delete"), canvasContext), { kind: "delete" });
	assert.deepEqual(canvasKeyCommand(key("Backspace"), { ...canvasContext, dragging: true }), { kind: "delete" });
	assert.equal(canvasKeyCommand(key("Delete"), { ...canvasContext, hasSelection: false }), undefined);
});

test("arrow keys move the selected child or the selection in drawing coordinates", () => {
	assert.deepEqual(canvasKeyCommand(key("ArrowUp"), { ...canvasContext, childSelected: true }), {
		kind: "move-child",
		delta: { x: 0, y: 2 },
	});
	assert.deepEqual(canvasKeyCommand(key("ArrowLeft", { shiftKey: true }), { ...canvasContext, childSelected: true }), {
		kind: "move-child",
		delta: { x: -20, y: 0 },
	});
	assert.deepEqual(canvasKeyCommand(key("ArrowDown"), canvasContext), {
		kind: "move-selection",
		delta: { x: 0, y: -5 },
		endWire: false,
	});
	assert.deepEqual(canvasKeyCommand(key("ArrowRight", { shiftKey: true }), { ...canvasContext, wiring: true }), {
		kind: "move-selection",
		delta: { x: 50, y: 0 },
		endWire: true,
	});
	assert.equal(canvasKeyCommand(key("ArrowRight"), { ...canvasContext, hasSelection: false }), undefined);
	assert.equal(canvasKeyCommand(key("a"), canvasContext), undefined);
});

test("arrow keys during a drag are swallowed, even with a child selected", () => {
	assert.deepEqual(canvasKeyCommand(key("ArrowUp"), { ...canvasContext, dragging: true }), { kind: "ignore" });
	assert.deepEqual(canvasKeyCommand(key("ArrowUp"), { ...canvasContext, dragging: true, childSelected: true }), { kind: "ignore" });
});
