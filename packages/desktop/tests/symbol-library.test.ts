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
	type SymbolFile,
} from "@ecad/core/components/editor/symbolFormat.ts";
import { configPaths } from "#/main/config-directory.ts";
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

test("external file changes reject a stale save without adding files", async () => {
	await withDirectory(async (directory) => {
		const library = new DesktopSymbolLibrary(directory);
		await library.load();
		await writeFile(
			join(directory, "external.ecadsym"),
			JSON.stringify(symbol("external")),
		);
		await assert.rejects(library.save([symbol("new")], [symbol("new")]));
		assert.deepEqual(await readdir(directory), ["external.ecadsym"]);
	});
});

test("failed writes roll back additions and never replace existing paths", async () => {
	await withDirectory(async (directory) => {
		await mkdir(join(directory, "blocked.ecadsym"));
		const library = new DesktopSymbolLibrary(directory);
		await library.load();
		const added = [symbol("first"), symbol("blocked")];
		await assert.rejects(library.save(added, added));
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
			JSON.parse(await readFile(storage.configurationPath, "utf8")),
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
		assert.deepEqual(await readdir(configPaths(home).directory), [
			"symbol-libraries.json",
		]);
		await writeFile(storage.configurationPath, "{");
		await assert.rejects(storage.loadConfiguration());
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
			await mkdir(configPaths(home).directory, { recursive: true });
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

test("the user configuration moves from ~/.ecad to the platform configuration directory", async () => {
	await withDirectory(async (home) => {
		const { defaultSymbolConfig } = await import(
			"@ecad/core/symbol-library/config.ts"
		);
		const legacy = {
			...defaultSymbolConfig(),
			symbolLibraries: defaultSymbolConfig().symbolLibraries.map((library) => ({
				...library,
				enabled: false,
			})),
		};
		await mkdir(join(home, ".ecad"));
		await writeFile(join(home, ".ecad", "config.json"), JSON.stringify(legacy));
		const storage = new DesktopSymbolLibrary(undefined, home);
		assert.equal(
			storage.configurationPath,
			join(configPaths(home).directory, "symbol-libraries.json"),
		);
		assert.deepEqual(await storage.loadConfiguration(), legacy);
	});
});
