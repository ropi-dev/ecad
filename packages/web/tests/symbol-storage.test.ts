import assert from "node:assert/strict";
import { test } from "node:test";
import {
	parseSymbolFile,
	SYMBOL_STORAGE_KEY,
} from "@ecad/core/components/editor/symbolFormat.ts";
import { createWebSymbolLibraryStorage } from "#/symbol-library/storage.ts";

const symbol = (id = "custom-test-point") =>
	parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id,
			name: "Custom test point",
			description: "Imported symbol",
			prefix: "TP",
			value: "Test",
			shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }],
		}),
	);

function memoryStorage(initial?: string) {
	const entries = new Map<string, string>();
	if (initial !== undefined) entries.set(SYMBOL_STORAGE_KEY, initial);
	return {
		entries,
		getItem(key: string) {
			return entries.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			entries.set(key, value);
		},
	};
}

test("web storage loads the existing cache and saves the complete merged library", async () => {
	const original = symbol();
	const addition = symbol("second-test-point");
	const cached = JSON.stringify([original]);
	const browser = memoryStorage(cached);
	const storage = createWebSymbolLibraryStorage(browser);
	assert.equal(storage.mode, "web");
	assert.equal(storage.openDirectory, undefined);
	assert.deepEqual(await storage.load(), { symbols: [original] });
	assert.equal(browser.entries.get(SYMBOL_STORAGE_KEY), cached);

	await storage.save([original, addition], [addition]);
	assert.equal(
		browser.entries.get(SYMBOL_STORAGE_KEY),
		JSON.stringify([original, addition]),
	);
	assert.deepEqual(await createWebSymbolLibraryStorage(browser).load(), {
		symbols: [original, addition],
	});
});

test("corrupt or incompatible caches reject and keep the original cache", async () => {
	for (const cached of [
		"{",
		JSON.stringify({ format: "ecad-symbols", version: 2, symbols: [] }),
		JSON.stringify([symbol(), symbol()]),
	]) {
		const browser = memoryStorage(cached);
		await assert.rejects(createWebSymbolLibraryStorage(browser).load(), Error);
		assert.equal(browser.entries.get(SYMBOL_STORAGE_KEY), cached);
	}
});

test("quota failures return a warning without rejecting the imported library", async () => {
	const original = symbol();
	const incoming = symbol("another-test-point");
	const cached = JSON.stringify([original]);
	const browser = memoryStorage(cached);
	const storage = createWebSymbolLibraryStorage({
		getItem: browser.getItem,
		setItem() {
			throw new DOMException("Quota exceeded", "QuotaExceededError");
		},
	});
	const merged = [original, incoming];
	const saved = await createWebSymbolLibraryStorage(memoryStorage()).save(
		merged,
		[incoming],
	);
	assert.notEqual(await storage.save(merged, [incoming]), saved);
	assert.deepEqual(merged, [original, incoming]);
	assert.equal(browser.entries.get(SYMBOL_STORAGE_KEY), cached);
	assert.deepEqual(await storage.load(), { symbols: [original] });
});
