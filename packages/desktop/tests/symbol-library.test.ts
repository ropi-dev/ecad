import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	parseSymbolFile,
	SYMBOL_FILE_LIMIT,
	type SymbolFile,
} from "@ecad/core/components/editor/symbolFormat.ts";
import { DesktopSymbolLibrary, readSymbolDirectory } from "#/main/symbol-library.ts";

function symbol(id: string): SymbolFile {
	return parseSymbolFile(JSON.stringify({
		format: "ecad-symbol",
		version: 1,
		units: "mm",
		id,
		name: id,
		description: "",
		prefix: "U",
		value: "",
		shapes: [{ kind: "circle", x: 0, y: 0, radius: 1 }],
	}));
}

async function withDirectory(run: (directory: string) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), "ecad-desktop-"));
	try {
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("loads nested symbol files and ignores other files and symlinks", async () => {
	await withDirectory(async (directory) => {
		await mkdir(join(directory, "nested"));
		await writeFile(join(directory, "first.ecadsym"), JSON.stringify(symbol("first")));
		await writeFile(join(directory, "nested", "second.JSON"), JSON.stringify(symbol("second")));
		await writeFile(join(directory, "readme.txt"), "This is not a symbol.");
		await symlink(directory, join(directory, "loop"), "dir");
		await symlink(join(directory, "first.ecadsym"), join(directory, "duplicate.ecadsym"));
		const snapshot = await readSymbolDirectory(directory);
		assert.equal(snapshot.directory, directory);
		assert.deepEqual(snapshot.symbols.map((entry) => entry.id), ["first", "second"]);
	});
});

test("refreshes files on load and keeps the old directory when opening another fails", async () => {
	await withDirectory(async (directory) => {
		const library = new DesktopSymbolLibrary(directory);
		assert.deepEqual((await library.load()).symbols, []);
		await writeFile(join(directory, "new.ecadsym"), JSON.stringify(symbol("new")));
		assert.equal((await library.load()).symbols[0].id, "new");
		await mkdir(join(directory, "invalid"));
		await writeFile(join(directory, "invalid", "broken.ecadsym"), "{}");
		await assert.rejects(library.openDirectory(join(directory, "invalid")), /broken.ecadsym/);
		await rm(join(directory, "invalid"), { recursive: true });
		const restored = await library.load();
		assert.equal(restored.directory, directory);
		assert.equal(restored.symbols[0].id, "new");
	});
});

test("requires an opened directory for persistence", async () => {
	const library = new DesktopSymbolLibrary();
	assert.deepEqual(await library.load(), { symbols: [], directory: undefined });
	await assert.rejects(library.save([symbol("new")], [symbol("new")]), /Open a symbol directory/);
});

test("saves sequential additions even when filename order changes after reloading", async () => {
	await withDirectory(async (directory) => {
		const first = symbol("zulu");
		const second = symbol("alpha");
		const third = symbol("bravo");
		await writeFile(join(directory, "zz-original.json"), JSON.stringify(first));
		const library = new DesktopSymbolLibrary(directory);
		await library.load();
		assert.match(await library.save([first, second], [second]), /Saved 1 symbol/);
		assert.match(await library.save([first, second, third], [third]), /Saved 1 symbol/);
		assert.deepEqual((await library.load()).symbols.map((entry) => entry.id), ["alpha", "bravo", "zulu"]);
		assert.equal(parseSymbolFile(await readFile(join(directory, "bravo.ecadsym"), "utf8")).id, "bravo");
	});
});

test("external file changes reject a stale save without adding files", async () => {
	await withDirectory(async (directory) => {
		const library = new DesktopSymbolLibrary(directory);
		await library.load();
		await writeFile(join(directory, "external.ecadsym"), JSON.stringify(symbol("external")));
		await assert.rejects(library.save([symbol("new")], [symbol("new")]), /directory changed/);
		assert.deepEqual(await readdir(directory), ["external.ecadsym"]);
	});
});

test("failed writes roll back additions and never replace existing paths", async () => {
	await withDirectory(async (directory) => {
		await mkdir(join(directory, "blocked.ecadsym"));
		const library = new DesktopSymbolLibrary(directory);
		await library.load();
		const added = [symbol("first"), symbol("blocked")];
		await assert.rejects(library.save(added, added), /Unable to save symbols/);
		assert.deepEqual(await readdir(directory), ["blocked.ecadsym"]);
		assert.deepEqual((await library.load()).symbols, []);
	});
});

test("rejects duplicated IDs across separate files", async () => {
	await withDirectory(async (directory) => {
		const content = JSON.stringify(symbol("same"));
		await writeFile(join(directory, "one.ecadsym"), content);
		await writeFile(join(directory, "two.json"), content);
		await assert.rejects(readSymbolDirectory(directory), /duplicated or reserved/);
	});
});

test("rejects invalid IPC symbol data before writing files", async () => {
	await withDirectory(async (directory) => {
		const library = new DesktopSymbolLibrary(directory);
		await library.load();
		const bad = [{ ...symbol("new"), id: "../outside" }] as SymbolFile[];
		await assert.rejects(library.save(bad, bad), /Invalid symbol file/);
		assert.deepEqual(await readdir(directory), []);
	});
});

test("limits directory imports to 100 files", async () => {
	await withDirectory(async (directory) => {
		await Promise.all(Array.from({ length: 101 }, (_, index) =>
			writeFile(join(directory, `${index}.ecadsym`), JSON.stringify(symbol(`s${index}`))),
		));
		await assert.rejects(readSymbolDirectory(directory), /at most 100/);
	});
});

test("counts source bytes across files before accepting a directory", async () => {
	await withDirectory(async (directory) => {
		for (const id of ["first", "second"]) {
			await writeFile(join(directory, `${id}.ecadsym`), `${JSON.stringify(symbol(id))}${" ".repeat(600_000)}`);
		}
		await assert.rejects(readSymbolDirectory(directory), /total 1 MB/);
	});
});

test("save checks actual existing file bytes before publishing additions", async () => {
	await withDirectory(async (directory) => {
		const original = symbol("existing");
		const content = JSON.stringify(original);
		await writeFile(join(directory, "original.ecadsym"), `${content}${" ".repeat(SYMBOL_FILE_LIMIT - content.length - 10)}`);
		const library = new DesktopSymbolLibrary(directory);
		await library.load();
		const incoming = symbol("new");
		await assert.rejects(library.save([original, incoming], [incoming]), /total 1 MB/);
		assert.deepEqual(await readdir(directory), ["original.ecadsym"]);
	});
});
