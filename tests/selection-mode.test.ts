import assert from "node:assert/strict";
import { test } from "node:test";
import {
	applySelection,
	selectionMode,
} from "#/components/editor/selectionMode.ts";

const modifiers = (ctrlKey: boolean, shiftKey: boolean) => ({
	ctrlKey,
	metaKey: false,
	shiftKey,
});

test("Ctrl adds, Ctrl + Shift removes and Shift alone toggles", () => {
	assert.equal(selectionMode(modifiers(false, false)), "replace");
	assert.equal(selectionMode(modifiers(false, true)), "toggle");
	assert.equal(selectionMode(modifiers(true, false)), "add");
	assert.equal(selectionMode(modifiers(true, true)), "remove");
});

test("each mode combines the current selection with the picked items", () => {
	const current = new Set([1, 2]);
	assert.deepEqual(applySelection(current, [2, 3], "replace"), new Set([2, 3]));
	assert.deepEqual(applySelection(current, [2, 3], "add"), new Set([1, 2, 3]));
	assert.deepEqual(applySelection(current, [2, 3], "remove"), new Set([1]));
	assert.deepEqual(applySelection(current, [2, 3], "toggle"), new Set([1, 3]));
	assert.deepEqual(current, new Set([1, 2]));
});
