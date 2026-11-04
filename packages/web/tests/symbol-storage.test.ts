import assert from "node:assert/strict";
import { test } from "node:test";
import {
	parseSymbolFile,
	SYMBOL_STORAGE_KEY,
} from "@ecad/core/components/editor/symbolFormat.ts";
import { createWebSymbolLibraryStorage } from "#/symbol-library/storage.ts";
import { required } from "../../../tests/helpers/required.ts";

const loadFailure =
	"Saved symbols could not be loaded. You can upload a library again.";
const saveFailure =
	"Browser storage is unavailable; these symbols will be lost when you leave or reload the editor.";

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

	assert.equal(
		await storage.save([original, addition], [addition]),
		"Saved in this browser.",
	);
	assert.equal(
		browser.entries.get(SYMBOL_STORAGE_KEY),
		JSON.stringify([original, addition]),
	);
	assert.deepEqual(await createWebSymbolLibraryStorage(browser).load(), {
		symbols: [original, addition],
	});
});

test("an absent cache starts empty without creating a saved library", async () => {
	const browser = memoryStorage();
	assert.deepEqual(await createWebSymbolLibraryStorage(browser).load(), {
		symbols: [],
	});
	assert.equal(browser.entries.size, 0);
});

test("corrupt or incompatible caches report a useful error and keep the original cache", async () => {
	for (const cached of [
		"{",
		JSON.stringify({ format: "ecad-symbols", version: 2, symbols: [] }),
		JSON.stringify([symbol(), symbol()]),
	]) {
		const browser = memoryStorage(cached);
		await assert.rejects(createWebSymbolLibraryStorage(browser).load(), {
			message: loadFailure,
		});
		assert.equal(browser.entries.get(SYMBOL_STORAGE_KEY), cached);
	}
});

test("unreadable storage reports the load error while a later import can still save", async () => {
	const browser = memoryStorage();
	let readable = false;
	const storage = createWebSymbolLibraryStorage({
		getItem(key) {
			if (!readable) throw new Error("Browser storage is blocked");
			return browser.getItem(key);
		},
		setItem: browser.setItem,
	});
	await assert.rejects(storage.load(), { message: loadFailure });
	const imported = symbol();
	assert.equal(
		await storage.save([imported], [imported]),
		"Saved in this browser.",
	);
	readable = true;
	assert.deepEqual(await storage.load(), { symbols: [imported] });
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
	assert.equal(await storage.save(merged, [incoming]), saveFailure);
	assert.deepEqual(merged, [original, incoming]);
	assert.equal(browser.entries.get(SYMBOL_STORAGE_KEY), cached);
	assert.deepEqual(await storage.load(), { symbols: [original] });
});

test("the browser storage getter is lazy and unavailable browser storage stays nonfatal on save", async () => {
	const descriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		"localStorage",
	);
	let accesses = 0;
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		get() {
			accesses += 1;
			throw new Error("No browser storage on the server");
		},
	});
	try {
		const storage = createWebSymbolLibraryStorage();
		assert.equal(accesses, 0);
		await assert.rejects(storage.load(), { message: loadFailure });
		assert.equal(accesses, 1);
		assert.equal(await storage.save([symbol()], [symbol()]), saveFailure);
		assert.equal(accesses, 2);

		const injected = createWebSymbolLibraryStorage(memoryStorage());
		assert.deepEqual(await injected.load(), { symbols: [] });
		assert.equal(accesses, 2);
	} finally {
		if (descriptor)
			Object.defineProperty(globalThis, "localStorage", descriptor);
		else Reflect.deleteProperty(globalThis, "localStorage");
	}
});

test("user library configuration ignores the symbol cache and saves enabled libraries independently", async () => {
	const { USER_SYMBOL_CONFIG_KEY } = await import(
		"@ecad/core/symbol-library/config.ts"
	);
	const browser = memoryStorage(JSON.stringify([symbol()]));
	const storage = createWebSymbolLibraryStorage(browser);
	const config = await required(storage.loadConfiguration)();
	assert.equal(config.symbolLibraries.length, 1);
	assert.equal(browser.entries.has(USER_SYMBOL_CONFIG_KEY), false);
	const disabled = {
		...config,
		symbolLibraries: config.symbolLibraries.map((library) => ({
			...library,
			enabled: false,
		})),
	};
	assert.equal(
		await required(storage.saveConfiguration)(disabled),
		"Saved in this browser.",
	);
	assert.deepEqual(
		await required(createWebSymbolLibraryStorage(browser).loadConfiguration)(),
		disabled,
	);
	assert.equal(browser.entries.has(SYMBOL_STORAGE_KEY), true);
	await required(storage.saveConfiguration)({
		version: 1,
		symbolLibraries: [],
	});
	assert.deepEqual(
		(await required(storage.loadConfiguration)()).symbolLibraries,
		[],
	);
});

test("temporary user configuration survives navigation and clears after a successful retry", async () => {
	const browser = memoryStorage();
	let writable = false;
	const storage = createWebSymbolLibraryStorage({
		getItem: browser.getItem,
		setItem(key, value) {
			if (!writable)
				throw new DOMException("Quota exceeded", "QuotaExceededError");
			browser.setItem(key, value);
		},
	});
	const original = await required(storage.loadConfiguration)();
	const next = {
		...original,
		symbolLibraries: [
			...original.symbolLibraries,
			{
				id: "imported",
				name: "Imported symbols",
				enabled: true,
				source: { kind: "embedded" as const, symbols: [symbol()] },
			},
		],
	};
	assert.equal(await required(storage.saveConfiguration)(next), saveFailure);
	assert.deepEqual(await required(storage.loadConfiguration)(), next);
	assert.deepEqual(
		await required(createWebSymbolLibraryStorage(browser).loadConfiguration)(),
		original,
	);
	writable = true;
	assert.equal(
		await required(storage.saveConfiguration)(next),
		"Saved in this browser.",
	);
	assert.deepEqual(
		await required(createWebSymbolLibraryStorage(browser).loadConfiguration)(),
		next,
	);
	await required(createWebSymbolLibraryStorage(browser).saveConfiguration)(
		original,
	);
	assert.deepEqual(await required(storage.loadConfiguration)(), original);
});
