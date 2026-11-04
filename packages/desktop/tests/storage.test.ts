import assert from "node:assert/strict";
import { test } from "node:test";
import type { SymbolLibrary } from "@ecad/core/components/editor/symbolFormat.ts";
import { createDesktopSymbolLibraryStorage } from "#/renderer/storage.ts";
import { required } from "../../../tests/helpers/required.ts";

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

test("desktop configuration and scoped directory reads use the existing preload bridge", async () => {
	const { defaultSymbolConfig } = await import(
		"@ecad/core/symbol-library/config.ts"
	);
	const config = defaultSymbolConfig();
	const calls: unknown[] = [];
	const storage = createDesktopSymbolLibraryStorage({
		async load() {
			return { symbols: [] };
		},
		async save() {
			return "Legacy save";
		},
		async openDirectory() {
			return null;
		},
		async loadConfiguration() {
			calls.push("loadConfiguration");
			return config;
		},
		async saveConfiguration(next) {
			calls.push(["saveConfiguration", next]);
			return "Saved config";
		},
		async openLibraryDirectory(name) {
			calls.push(["openLibraryDirectory", name]);
			return null;
		},
		async loadDirectory(path, scope, directory) {
			calls.push(["loadDirectory", path, scope, directory]);
			return [];
		},
	});
	assert.equal(await required(storage.loadConfiguration)(), config);
	assert.equal(
		await required(storage.saveConfiguration)(config),
		"Saved config",
	);
	assert.equal(
		await required(storage.openLibraryDirectory)("Project parts"),
		null,
	);
	assert.deepEqual(
		await required(storage.loadDirectory)("libraries", "project", "/project"),
		[],
	);
	assert.deepEqual(calls, [
		"loadConfiguration",
		["saveConfiguration", config],
		["openLibraryDirectory", "Project parts"],
		["loadDirectory", "libraries", "project", "/project"],
	]);
});

test("desktop library writes invalidate subscribers, but reads and failed writes do not", async () => {
	const { defaultSymbolConfig } = await import(
		"@ecad/core/symbol-library/config.ts"
	);
	let fail = false;
	const storage = createDesktopSymbolLibraryStorage({
		async load() {
			return { symbols: [] };
		},
		async save() {
			if (fail) throw new Error("Disk full");
			return "Saved";
		},
		async openDirectory() {
			return null;
		},
		async saveConfiguration() {
			return "Saved";
		},
	});
	let updates = 0;
	const stop = required(storage.subscribe)(() => {
		updates++;
	});
	await storage.load();
	assert.equal(updates, 0);
	await storage.save([], []);
	assert.equal(updates, 1);
	await required(storage.saveConfiguration)(defaultSymbolConfig());
	assert.equal(updates, 2);
	fail = true;
	await assert.rejects(storage.save([], []), /Disk full/);
	assert.equal(updates, 2);
	stop();
	await required(storage.saveConfiguration)(defaultSymbolConfig());
	assert.equal(updates, 2);
});
