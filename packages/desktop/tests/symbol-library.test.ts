import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	parseSymbolFile,
	SYMBOL_FILE_LIMIT,
	type SymbolFile,
} from "@ecad/core/components/editor/symbolFormat.ts";
import {
	DesktopSymbolLibrary,
	readSymbolDirectory,
} from "#/main/symbol-library.ts";

function symbol(id: string): SymbolFile {
	return parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id,
			name: id,
			description: "",
			prefix: "U",
			value: "",
			shapes: [{ kind: "circle", x: 0, y: 0, radius: 1 }],
		}),
	);
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
		await writeFile(
			join(directory, "first.ecadsym"),
			JSON.stringify(symbol("first")),
		);
		await writeFile(
			join(directory, "nested", "second.JSON"),
			JSON.stringify(symbol("second")),
		);
		await writeFile(join(directory, "readme.txt"), "This is not a symbol.");
		await symlink(directory, join(directory, "loop"), "dir");
		await symlink(
			join(directory, "first.ecadsym"),
			join(directory, "duplicate.ecadsym"),
		);
		const snapshot = await readSymbolDirectory(directory);
		assert.equal(snapshot.directory, directory);
		assert.deepEqual(
			snapshot.symbols.map((entry) => entry.id),
			["first", "second"],
		);
	});
});

test("refreshes files on load and keeps the old directory when opening another fails", async () => {
	await withDirectory(async (directory) => {
		const library = new DesktopSymbolLibrary(directory);
		assert.deepEqual((await library.load()).symbols, []);
		await writeFile(
			join(directory, "new.ecadsym"),
			JSON.stringify(symbol("new")),
		);
		assert.equal((await library.load()).symbols[0].id, "new");
		await mkdir(join(directory, "invalid"));
		await writeFile(join(directory, "invalid", "broken.ecadsym"), "{}");
		await assert.rejects(
			library.openDirectory(join(directory, "invalid")),
			/broken.ecadsym/,
		);
		await rm(join(directory, "invalid"), { recursive: true });
		const restored = await library.load();
		assert.equal(restored.directory, directory);
		assert.equal(restored.symbols[0].id, "new");
	});
});

test("requires an opened directory for persistence", async () => {
	const library = new DesktopSymbolLibrary();
	assert.deepEqual(await library.load(), { symbols: [], directory: undefined });
	await assert.rejects(
		library.save([symbol("new")], [symbol("new")]),
		/Open a symbol directory/,
	);
});

test("saves sequential additions even when filename order changes after reloading", async () => {
	await withDirectory(async (directory) => {
		const first = symbol("zulu");
		const second = symbol("alpha");
		const third = symbol("bravo");
		await writeFile(join(directory, "zz-original.json"), JSON.stringify(first));
		const library = new DesktopSymbolLibrary(directory);
		await library.load();
		assert.match(
			await library.save([first, second], [second]),
			/Saved 1 symbol/,
		);
		assert.match(
			await library.save([first, second, third], [third]),
			/Saved 1 symbol/,
		);
		assert.deepEqual(
			(await library.load()).symbols.map((entry) => entry.id),
			["alpha", "bravo", "zulu"],
		);
		assert.equal(
			parseSymbolFile(await readFile(join(directory, "bravo.ecadsym"), "utf8"))
				.id,
			"bravo",
		);
	});
});

test("external file changes reject a stale save without adding files", async () => {
	await withDirectory(async (directory) => {
		const library = new DesktopSymbolLibrary(directory);
		await library.load();
		await writeFile(
			join(directory, "external.ecadsym"),
			JSON.stringify(symbol("external")),
		);
		await assert.rejects(
			library.save([symbol("new")], [symbol("new")]),
			/directory changed/,
		);
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
		await assert.rejects(
			readSymbolDirectory(directory),
			/duplicated or reserved/,
		);
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
		await Promise.all(
			Array.from({ length: 101 }, (_, index) =>
				writeFile(
					join(directory, `${index}.ecadsym`),
					JSON.stringify(symbol(`s${index}`)),
				),
			),
		);
		await assert.rejects(readSymbolDirectory(directory), /at most 100/);
	});
});

test("counts source bytes across files before accepting a directory", async () => {
	await withDirectory(async (directory) => {
		for (const id of ["first", "second"]) {
			await writeFile(
				join(directory, `${id}.ecadsym`),
				`${JSON.stringify(symbol(id))}${" ".repeat(600_000)}`,
			);
		}
		await assert.rejects(readSymbolDirectory(directory), /total 1 MB/);
	});
});

test("save checks actual existing file bytes before publishing additions", async () => {
	await withDirectory(async (directory) => {
		const original = symbol("existing");
		const content = JSON.stringify(original);
		await writeFile(
			join(directory, "original.ecadsym"),
			`${content}${" ".repeat(SYMBOL_FILE_LIMIT - content.length - 10)}`,
		);
		const library = new DesktopSymbolLibrary(directory);
		await library.load();
		const incoming = symbol("new");
		await assert.rejects(
			library.save([original, incoming], [incoming]),
			/total 1 MB/,
		);
		assert.deepEqual(await readdir(directory), ["original.ecadsym"]);
	});
});

test("desktop user configuration persists in the home directory and validates before replacing it", async () => {
	await withDirectory(async (home) => {
		const { defaultSymbolConfig } = await import(
			"@ecad/core/symbol-library/config.ts"
		);
		const storage = new DesktopSymbolLibrary(undefined, home);
		assert.deepEqual(await storage.loadConfiguration(), defaultSymbolConfig());
		const directory = join(home, "parts");
		await mkdir(directory);
		await writeFile(
			join(directory, "point.ecadsym"),
			JSON.stringify(symbol("point")),
		);
		const source = await storage.openLibraryDirectory(directory, "Parts");
		const config = {
			version: 1 as const,
			symbolLibraries: [...defaultSymbolConfig().symbolLibraries, source],
		};
		await storage.saveConfiguration(config);
		assert.deepEqual(
			JSON.parse(await readFile(join(home, ".ecad", "config.json"), "utf8")),
			config,
		);
		const reopened = new DesktopSymbolLibrary(undefined, home);
		assert.deepEqual(await reopened.loadConfiguration(), config);
		assert.deepEqual(await reopened.loadConfiguredDirectory(directory), [
			symbol("point"),
		]);
		await assert.rejects(
			reopened.loadConfiguredDirectory(home),
			/not configured/,
		);
		await assert.rejects(
			storage.saveConfiguration({
				...config,
				symbolLibraries: [source, source],
			}),
			/duplicated/,
		);
		assert.deepEqual(await reopened.loadConfiguration(), config);
		assert.deepEqual(await readdir(join(home, ".ecad")), ["config.json"]);
		await writeFile(join(home, ".ecad", "config.json"), "{");
		await assert.rejects(storage.loadConfiguration());
	});
});

test("configured relative user directories resolve against the home directory", async () => {
	await withDirectory(async (home) => {
		await mkdir(join(home, "parts"));
		await mkdir(join(home, ".ecad"));
		await writeFile(
			join(home, "parts", "point.ecadsym"),
			JSON.stringify(symbol("point")),
		);
		for (const path of ["parts", "~/parts"]) {
			// The user wrote these paths into their own configuration.
			const config = {
				version: 1 as const,
				symbolLibraries: [
					{
						id: "parts",
						name: "Parts",
						enabled: true,
						source: { kind: "directory" as const, path },
					},
				],
			};
			await writeFile(
				join(home, ".ecad", "config.json"),
				JSON.stringify(config),
			);
			const storage = new DesktopSymbolLibrary(undefined, home);
			assert.deepEqual(await storage.loadConfiguredDirectory(path), [
				symbol("point"),
			]);
			// Saving keeps paths that are already configured.
			const disabled = {
				...config,
				symbolLibraries: [{ ...config.symbolLibraries[0], enabled: false }],
			};
			await storage.saveConfiguration(disabled);
			assert.deepEqual(await storage.loadConfiguration(), disabled);
		}
	});
});

test("user configuration saves accept only directories the main process chose or the user configured", async () => {
	await withDirectory(async (home) => {
		const { defaultSymbolConfig } = await import(
			"@ecad/core/symbol-library/config.ts"
		);
		const outside = await mkdtemp(join(tmpdir(), "ecad-outside-"));
		try {
			await writeFile(
				join(outside, "secret.ecadsym"),
				JSON.stringify(symbol("secret")),
			);
			const storage = new DesktopSymbolLibrary(undefined, home);
			const builtin = defaultSymbolConfig().symbolLibraries;
			const injected = (path: string) => ({
				version: 1 as const,
				symbolLibraries: [
					...builtin,
					{
						id: "injected",
						name: "Injected",
						enabled: true,
						source: { kind: "directory" as const, path },
					},
				],
			});
			for (const path of [outside, "~/../..", "..", "~/.ssh"])
				await assert.rejects(
					storage.saveConfiguration(injected(path)),
					/Add library directory/,
				);
			await assert.rejects(readFile(storage.configurationPath), {
				code: "ENOENT",
			});
			await assert.rejects(
				storage.loadConfiguredDirectory(outside),
				/not configured/,
			);

			// A damaged configuration trusts nothing, but a safe configuration can replace it.
			await mkdir(join(home, ".ecad"));
			await writeFile(storage.configurationPath, "{");
			await assert.rejects(
				storage.saveConfiguration(injected(outside)),
				/Add library directory/,
			);
			await storage.saveConfiguration(defaultSymbolConfig());
			assert.deepEqual(
				await storage.loadConfiguration(),
				defaultSymbolConfig(),
			);

			const chosen = await storage.openLibraryDirectory(outside, "Chosen");
			await storage.saveConfiguration({
				version: 1,
				symbolLibraries: [...builtin, chosen],
			});
			assert.deepEqual(
				await new DesktopSymbolLibrary(undefined, home).loadConfiguredDirectory(
					chosen.source.kind === "directory" ? chosen.source.path : "",
				),
				[symbol("secret")],
			);
			// A renamed path is a different directory and still needs the picker.
			await assert.rejects(
				storage.saveConfiguration(injected(`${outside}/..`)),
				/Add library directory/,
			);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});
});

test("edits the original nested filename in a configured writable library", async () => {
	await withDirectory(async (home) => {
		const { stat } = await import("node:fs/promises");
		const directory = join(home, "parts");
		await mkdir(join(directory, "nested"), { recursive: true });
		const original = {
			...symbol("editable"),
			description: "Preserve metadata",
			prefix: "TP",
			value: "Signal",
		};
		const filename = join(directory, "nested", "unrelated-filename.JSON");
		await writeFile(filename, JSON.stringify(original), { mode: 0o640 });
		const library = new DesktopSymbolLibrary(undefined, home);
		const entry = await library.openLibraryDirectory(directory);
		await library.saveConfiguration({ version: 1, symbolLibraries: [entry] });
		assert.deepEqual(
			await library.inspectConfiguredSymbol(directory, original.id),
			{ file: original, writable: true },
		);
		const next = {
			...original,
			shapes: [
				...original.shapes,
				{ kind: "pin" as const, name: "New pin", x: 3, y: 4 },
			],
		};
		await library.saveConfiguredSymbol(directory, original, next);
		assert.deepEqual(parseSymbolFile(await readFile(filename, "utf8")), next);
		assert.equal((await stat(filename)).mode & 0o777, 0o640);
		assert.deepEqual(await readdir(directory), ["nested"]);
		assert.deepEqual(await readdir(join(directory, "nested")), [
			"unrelated-filename.JSON",
		]);
		assert.deepEqual(
			await new DesktopSymbolLibrary(undefined, home).loadConfiguredDirectory(
				directory,
			),
			[next],
		);
		await assert.rejects(
			library.saveConfiguredSymbol(home, original, next),
			/not configured/,
		);
	});
});

test("definition permissions disable editing and prevent replacing read-only files", async () => {
	await withDirectory(async (home) => {
		const { chmod } = await import("node:fs/promises");
		const directory = join(home, "parts");
		await mkdir(directory);
		const original = symbol("editable");
		const filename = join(directory, "part.ecadsym");
		await writeFile(filename, JSON.stringify(original));
		const library = new DesktopSymbolLibrary(undefined, home);
		const entry = await library.openLibraryDirectory(directory);
		await library.saveConfiguration({ version: 1, symbolLibraries: [entry] });
		assert.equal(await library.canWriteConfiguration(), true);
		await chmod(library.configurationPath, 0o444);
		assert.equal(await library.canWriteConfiguration(), false);
		// Directory-file editing does not require a writable user configuration.
		assert.equal(
			(await library.inspectConfiguredSymbol(directory, original.id)).writable,
			true,
		);
		await chmod(filename, 0o444);
		assert.equal(
			(await library.inspectConfiguredSymbol(directory, original.id)).writable,
			false,
		);
		await assert.rejects(
			library.saveConfiguredSymbol(directory, original, {
				...original,
				shapes: [],
			}),
			/read-only/,
		);
		assert.deepEqual(
			parseSymbolFile(await readFile(filename, "utf8")),
			original,
		);
		await chmod(filename, 0o644);
		await chmod(directory, 0o555);
		try {
			assert.equal(
				(await library.inspectConfiguredSymbol(directory, original.id))
					.writable,
				false,
			);
			await assert.rejects(
				library.saveConfiguredSymbol(directory, original, {
					...original,
					shapes: [],
				}),
				/read-only/,
			);
		} finally {
			await chmod(directory, 0o755);
			await chmod(library.configurationPath, 0o644);
		}
	});
});

test("external edits, removed definitions, and ID changes never overwrite a directory symbol", async () => {
	await withDirectory(async (home) => {
		const directory = join(home, "parts");
		await mkdir(directory);
		const original = symbol("editable");
		const filename = join(directory, "part.ecadsym");
		await writeFile(filename, JSON.stringify(original));
		const library = new DesktopSymbolLibrary(undefined, home);
		const entry = await library.openLibraryDirectory(directory);
		await library.saveConfiguration({ version: 1, symbolLibraries: [entry] });
		await library.inspectConfiguredSymbol(directory, original.id);
		const external = { ...original, name: "Changed externally" };
		await writeFile(filename, JSON.stringify(external));
		await assert.rejects(
			library.saveConfiguredSymbol(directory, original, {
				...original,
				shapes: [],
			}),
			/definition changed/,
		);
		await assert.rejects(
			library.saveConfiguredSymbol(directory, external, {
				...external,
				id: "new-id",
			}),
			/cannot change/,
		);
		assert.deepEqual(
			parseSymbolFile(await readFile(filename, "utf8")),
			external,
		);
		assert.deepEqual(await readdir(directory), ["part.ecadsym"]);
		await rm(filename);
		await assert.rejects(
			library.inspectConfiguredSymbol(directory, original.id),
			/no longer exists/,
		);
		await assert.rejects(
			library.saveConfiguredSymbol(directory, original, original),
			/definition changed/,
		);
	});
});
