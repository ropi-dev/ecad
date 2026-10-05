import assert from "node:assert/strict";
import { test } from "node:test";
import type { SymbolLibrary } from "@ecad/core/components/editor/symbolFormat.ts";
import { createDesktopSymbolLibraryStorage } from "#/renderer/storage.ts";

test("desktop storage delegates only symbol operations to the preload bridge", async () => {
	const snapshot = { symbols: [] as SymbolLibrary, directory: "/symbols" };
	const calls: unknown[] = [];
	const storage = createDesktopSymbolLibraryStorage({
		async load() {
			calls.push("load");
			return snapshot;
		},
		async save(symbols, additions) {
			calls.push(["save", symbols, additions]);
			return "Saved to disk.";
		},
		async openDirectory() {
			calls.push("openDirectory");
			return null;
		},
	});
	assert.equal(storage.mode, "desktop");
	assert.equal(await storage.load(), snapshot);
	assert.equal(await storage.save([], []), "Saved to disk.");
	assert.equal(await storage.openDirectory?.(), null);
	assert.deepEqual(calls, ["load", ["save", [], []], "openDirectory"]);
});

test("desktop bridge errors reach the shared editor", async () => {
	const failure = new Error("The directory is unreadable.");
	const storage = createDesktopSymbolLibraryStorage({
		async load() { throw failure; },
		async save() { throw failure; },
		async openDirectory() { throw failure; },
	});
	await assert.rejects(storage.load(), failure);
	await assert.rejects(storage.save([], []), failure);
	const openDirectory = storage.openDirectory;
	assert.ok(openDirectory);
	await assert.rejects(openDirectory(), failure);
});
