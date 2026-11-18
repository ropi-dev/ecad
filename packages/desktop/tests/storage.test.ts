import assert from "node:assert/strict";
import { test } from "node:test";
import { createDesktopSymbolLibraryStorage } from "#/renderer/storage.ts";

test("desktop bridge errors reach the shared editor", async () => {
	const failure = new Error("The directory is unreadable.");
	const storage = createDesktopSymbolLibraryStorage({
		async load() {
			throw failure;
		},
		async save() {
			throw failure;
		},
		async openDirectory() {
			throw failure;
		},
	});
	await assert.rejects(storage.load(), failure);
	await assert.rejects(storage.save([], []), failure);
	const openDirectory = storage.openDirectory;
	assert.ok(openDirectory);
	await assert.rejects(openDirectory(), failure);
});
