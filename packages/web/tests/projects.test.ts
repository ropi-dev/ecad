import assert from "node:assert/strict";
import { test } from "node:test";
import type { EditorShape } from "@ecad/core/drawing/shapes.ts";
import {
	PROJECT_FILE,
	parseProjectManifest,
} from "@ecad/core/projects/format.ts";
import {
	type BrowserDirectory,
	createWebProjectStorage,
} from "#/projects/storage.ts";

function browserFilesystem() {
	const entries = new Map<string, Uint8Array>();
	const directories = new Set([""]);
	let failManifest = false;
	const missing = () => new DOMException("Not found", "NotFoundError");
	function handle(prefix: string): BrowserDirectory {
		const path = (name: string) => (prefix ? `${prefix}/${name}` : name);
		return {
			async getDirectoryHandle(name, options) {
				const directory = path(name);
				if (!directories.has(directory) && !options?.create) throw missing();
				directories.add(directory);
				return handle(directory);
			},
			async getFileHandle(name, options) {
				const file = path(name);
				if (!entries.has(file) && !options?.create) throw missing();
				return {
					async getFile() {
						return {
							async arrayBuffer() {
								const value = entries.get(file);
								if (!value) throw missing();
								return new Uint8Array(value).buffer;
							},
						};
					},
					async createWritable() {
						let pending: Uint8Array | undefined;
						return {
							async write(data) {
								if (failManifest && name === PROJECT_FILE)
									throw new DOMException(
										"Quota exceeded",
										"QuotaExceededError",
									);
								pending = new Uint8Array(data);
							},
							async close() {
								if (pending) entries.set(file, pending);
							},
							async abort() {
								pending = undefined;
							},
						};
					},
				};
			},
			async removeEntry(name) {
				const entry = path(name);
				for (const key of entries.keys())
					if (key === entry || key.startsWith(`${entry}/`)) entries.delete(key);
				for (const key of directories)
					if (key === entry || key.startsWith(`${entry}/`))
						directories.delete(key);
			},
			async *keys() {
				for (const key of directories) {
					if (
						key?.startsWith(prefix) &&
						key.split("/").length ===
							(prefix ? prefix.split("/").length + 1 : 1)
					)
						yield key.split("/").at(-1) as string;
				}
			},
		};
	}
	const selection = new Map<string, string>();
	return {
		entries,
		root: () => Promise.resolve(handle("")),
		selection: {
			getItem: (key: string) => selection.get(key) ?? null,
			setItem: (key: string, value: string) => {
				selection.set(key, value);
			},
		},
		fail: (value = true) => {
			failManifest = value;
		},
	};
}
const shape: EditorShape = {
	id: 3,
	kind: "circle",
	x: 1,
	y: 2,
	width: 5,
	height: 5,
	rotation: 0,
	lineWidth: 0.2,
};

test("browser projects keep additional drawings through revisions, imports and failed saves", async () => {
	const browser = browserFilesystem();
	const storage = createWebProjectStorage(browser.root, browser.selection);
	await storage.create("Drawings");
	const drawings = [
		{ id: "power", circuitId: "pcb-power", name: "Power", shapes: [shape] },
		{ id: "control", circuitId: "pcb-control", name: "Control", shapes: [] },
	];
	const saved = await storage.save("Drawings", {
		shapes: [],
		symbols: [],
		drawings,
	});
	assert.equal(saved.manifest.drawings?.length, 2);
	assert.deepEqual(
		(await createWebProjectStorage(browser.root, browser.selection).load())
			?.drawings,
		drawings,
	);
	browser.fail();
	await assert.rejects(
		storage.save("Drawings", {
			shapes: [shape],
			symbols: [],
			drawings: [{ ...drawings[0], shapes: [] }],
		}),
		/Quota exceeded/,
	);
	browser.fail(false);
	assert.deepEqual(
		(await createWebProjectStorage(browser.root, browser.selection).load())
			?.drawings,
		drawings,
	);
	await storage.importAssets("Drawings", [
		{ name: "board.gbr", kind: "gerber", bytes: new Uint8Array([1]) },
	]);
	const next = await storage.save("Drawings", { shapes: [shape], symbols: [] });
	assert.deepEqual(next.drawings, drawings);
	assert.deepEqual(
		(await createWebProjectStorage(browser.root, browser.selection).load())
			?.drawings,
		drawings,
	);
});

test("browser projects use named local directories, restore the active project and isolate source files", async () => {
	const browser = browserFilesystem();
	const storage = createWebProjectStorage(browser.root, browser.selection);
	assert.equal(await storage.load(), null);
	await storage.create("Controller");
	await storage.save("Controller", { shapes: [shape], symbols: [] });
	const bytes = new Uint8Array([0, 255, 200]);
	const saved = await storage.importAssets("Controller", [
		{ name: "model.step", kind: "step", bytes },
	]);
	const manifest = parseProjectManifest(
		new TextDecoder().decode(browser.entries.get("Controller/.ecadprj")),
	);
	assert.deepEqual(manifest, saved.manifest);
	assert.deepEqual(
		await storage.readAsset("Controller", manifest.assets[0].path),
		bytes,
	);
	assert.deepEqual(
		await createWebProjectStorage(browser.root, browser.selection).load(),
		saved,
	);
	await storage.create("Power supply");
	assert.deepEqual(await storage.list(), ["Controller", "Power supply"]);
	await assert.rejects(
		storage.readAsset("Controller", manifest.assets[0].path),
		/no longer open/,
	);
	assert.deepEqual((await storage.open("Controller"))?.shapes, [shape]);
	await assert.rejects(
		storage.readAsset("Controller", "../Power supply/.ecadprj"),
	);
	await assert.rejects(storage.create("Controller"), /already exists/);
	await assert.rejects(storage.create("../Controller"));
});

test("browser quota failures keep the last complete drawing and remove failed writes", async () => {
	const browser = browserFilesystem();
	const storage = createWebProjectStorage(browser.root, browser.selection);
	await storage.create("Controller");
	await storage.save("Controller", { shapes: [shape], symbols: [] });
	const before = [...browser.entries.keys()].sort();
	browser.fail();
	await assert.rejects(
		storage.save("Controller", { shapes: [], symbols: [] }),
		{ name: "QuotaExceededError" },
	);
	assert.deepEqual([...browser.entries.keys()].sort(), before);
	assert.deepEqual(
		(await createWebProjectStorage(browser.root, browser.selection).load())
			?.shapes,
		[shape],
	);
});

test("corrupt browser project manifests remain untouched and do not switch the active project", async () => {
	const browser = browserFilesystem();
	const storage = createWebProjectStorage(browser.root, browser.selection);
	await storage.create("Broken");
	await storage.create("Working");
	browser.entries.set(
		"Broken/.ecadprj",
		new TextEncoder().encode("invalid = ["),
	);
	await assert.rejects(storage.open("Broken"));
	assert.equal(
		(await createWebProjectStorage(browser.root, browser.selection).load())
			?.manifest.name,
		"Working",
	);
	assert.equal(
		new TextDecoder().decode(browser.entries.get("Broken/.ecadprj")),
		"invalid = [",
	);
});

test("failed browser project creation removes the incomplete directory and allows retrying", async () => {
	const browser = browserFilesystem();
	const storage = createWebProjectStorage(browser.root, browser.selection);
	browser.fail();
	await assert.rejects(storage.create("Controller"), {
		name: "QuotaExceededError",
	});
	assert.deepEqual(await storage.list(), []);
	browser.fail(false);
	assert.equal(
		(await storage.create("Controller"))?.manifest.name,
		"Controller",
	);
});

test("untitled web projects keep their display name and use separate restorable directories", async () => {
	const browser = browserFilesystem();
	const storage = createWebProjectStorage(browser.root, browser.selection);
	const first = await storage.create("Untitled");
	const second = await storage.create("Untitled");
	assert.equal(first?.manifest.name, "Untitled");
	assert.equal(second?.manifest.name, "Untitled");
	assert.notEqual(first?.directory, second?.directory);
	assert.deepEqual(await storage.load(), second);
	assert.deepEqual(await storage.open(first?.directory), first);
});

test("file URL selections survive autosave revisions and resolve the latest physical path", async () => {
	const { projectFileSelections, projectFileUrlPath } = await import(
		"@ecad/core/projects/file-url.ts"
	);
	const browser = browserFilesystem();
	const storage = createWebProjectStorage(browser.root, browser.selection);
	await storage.create("Controller");
	const symbol = {
		format: "ecad-symbol" as const,
		version: 1 as const,
		units: "mm" as const,
		id: "connector",
		name: "Connector",
		description: "",
		prefix: "J",
		value: "",
		shapes: [],
	};
	const before = await storage.save("Controller", {
		shapes: [],
		symbols: [symbol],
		drawings: [{ id: "power", name: "Power", shapes: [] }],
	});
	const selected = projectFileSelections(before);
	const after = await storage.save("Controller", {
		...before,
		shapes: [shape],
	});
	assert.notEqual(before.manifest.drawing, after.manifest.drawing);
	const current = projectFileSelections(after);
	assert.deepEqual(
		current.map(({ id, file, view }) => ({ id, file, view })),
		selected.map(({ id, file, view }) => ({ id, file, view })),
	);
	for (const old of selected) {
		const resolved = current.find(
			(entry) =>
				entry.file === projectFileUrlPath(old.path) && entry.view === old.view,
		);
		assert.equal(resolved?.id, old.id);
		assert.notEqual(resolved?.path, old.path);
		assert.ok(!resolved?.file.startsWith(".ecad/"));
	}
	assert.ok(current.some((entry) => entry.view === "circuit"));
	assert.ok(current.some((entry) => entry.id === "symbol:connector"));
	assert.ok(current.some((entry) => entry.id === "drawing:power"));
	assert.equal(
		projectFileUrlPath("assets/front panel.step"),
		"assets/front panel.step",
	);
});

test("browser tabs saving one project take its Web Lock, so the second save sees the first and conflicts", async () => {
	const browser = browserFilesystem();
	const first = createWebProjectStorage(browser.root, browser.selection);
	await first.create("Shared");
	const second = createWebProjectStorage(browser.root, browser.selection);
	await second.open("Shared");
	const [kept, lost] = await Promise.allSettled([
		first.save("Shared", { shapes: [shape], symbols: [] }),
		second.save("Shared", { shapes: [{ ...shape, id: 4 }], symbols: [] }),
	]);
	assert.equal(kept.status, "fulfilled");
	assert.equal(lost.status, "rejected");
	assert.equal((lost.reason as { _tag?: string })._tag, "ProjectConflict");
	const reopened = await createWebProjectStorage(
		browser.root,
		browser.selection,
	).open("Shared");
	assert.deepEqual(
		reopened?.shapes.map((saved) => saved.id),
		[shape.id],
	);
	// Another tab holding the project lock delays this tab's reload until it
	// releases the lock.
	let settled = false;
	let reload: Promise<unknown> | undefined;
	await navigator.locks.request("ecad-project:Shared", async () => {
		reload = second.open("Shared").finally(() => {
			settled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(settled, false);
	});
	assert.deepEqual(
		((await reload) as { shapes: EditorShape[] }).shapes.map(
			(saved) => saved.id,
		),
		[shape.id],
	);
});
