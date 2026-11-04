import assert from "node:assert/strict";
import { test } from "node:test";
import {
	dismissEditorIssues,
	editorIssues,
	retainDismissedIssues,
	visibleEditorMessages,
} from "#/components/editor/editorMessages.ts";

const libraryError = 'Symbol "resistor" is unavailable in library "missing".';
const projectError = "Quota exceeded";

test("issues drop empty sources and duplicates", () => {
	assert.deepEqual(
		editorIssues(["", libraryError, undefined, projectError, libraryError]),
		[libraryError, projectError],
	);
});

test("dismissed issues stay hidden while the command error stays visible", () => {
	const dismissed = dismissEditorIssues(new Set(), [libraryError]);
	assert.deepEqual(
		visibleEditorMessages(
			"Wire segments must be horizontal or vertical.",
			[libraryError, projectError],
			dismissed,
		),
		["Wire segments must be horizontal or vertical.", projectError],
	);
	assert.deepEqual(visibleEditorMessages("", [libraryError], dismissed), []);
});

test("dismissing during a library reload keeps earlier dismissals", () => {
	let dismissed = dismissEditorIssues(new Set(), [libraryError]);
	const reloading: string[] = [];
	assert.deepEqual(
		visibleEditorMessages("Paste failed.", reloading, dismissed),
		["Paste failed."],
	);
	dismissed = dismissEditorIssues(dismissed, reloading);
	const reloaded = [libraryError];
	assert.equal(retainDismissedIssues(dismissed, reloaded), dismissed);
	assert.deepEqual(visibleEditorMessages("", reloaded, dismissed), []);
});

test("resolved issues are forgotten so a recurrence is shown again", () => {
	const dismissed = dismissEditorIssues(new Set(), [
		libraryError,
		projectError,
	]);
	const retained = retainDismissedIssues(dismissed, [projectError]);
	assert.deepEqual([...retained], [projectError]);
	assert.deepEqual(
		visibleEditorMessages("", [libraryError, projectError], retained),
		[libraryError],
	);
});
