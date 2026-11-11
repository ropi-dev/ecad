import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { settingsChannels } from "#/bridge.ts";
import { configPaths } from "#/main/config-directory.ts";
import { parseIpcArguments } from "#/main/ipc.ts";
import { DesktopSettings } from "#/main/settings.ts";

async function withHome(run: (home: string) => Promise<void>) {
	const home = await mkdtemp(join(tmpdir(), "ecad-settings-"));
	try {
		await run(home);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

test("the configuration directory follows each platform's convention", () => {
	assert.equal(
		configPaths("/home/a", "linux").directory,
		"/home/a/.config/ecad",
	);
	assert.equal(
		configPaths("/Users/a", "darwin").directory,
		"/Users/a/Library/Application Support/ecad",
	);
	assert.equal(
		configPaths("/home/a", "win32").directory,
		join("/home/a", "AppData", "Roaming", "ecad"),
	);
	assert.equal(
		configPaths("/home/a", "linux").legacyDirectory,
		"/home/a/.ecad",
	);
});

test("global settings persist in settings.json and a damaged file loads as defaults", async () =>
	withHome(async (home) => {
		const settings = new DesktopSettings(home);
		assert.equal(
			settings.path,
			join(configPaths(home).directory, "settings.json"),
		);
		assert.deepEqual(await settings.load(), {
			path: settings.path,
			settings: { version: 1 },
		});
		const saved = {
			version: 1 as const,
			antialiasing: "off" as const,
			ercSeverity: { "unconnected-pin": "off" as const },
		};
		await settings.save(saved);
		assert.deepEqual(JSON.parse(await readFile(settings.path, "utf8")), saved);
		assert.deepEqual((await new DesktopSettings(home).load()).settings, saved);

		await writeFile(settings.path, "{");
		const damaged = await new DesktopSettings(home).load();
		assert.deepEqual(damaged.settings, { version: 1 });
		assert.match(damaged.error ?? "", /JSON/);
		await settings.save(saved);
		assert.deepEqual((await settings.load()).settings, saved);
	}));

test("settings saves keep fields from newer builds and reject invalid values", () => {
	assert.throws(
		() => parseIpcArguments(settingsChannels.save, [{ version: 2 }]),
		/version/,
	);
	assert.throws(
		() =>
			parseIpcArguments(settingsChannels.save, [
				{ version: 1, antialiasing: "sometimes" },
			]),
		/antialiasing/,
	);
	assert.deepEqual(
		parseIpcArguments(settingsChannels.save, [{ version: 1, theme: "dark" }]),
		[{ version: 1, theme: "dark" }],
	);
});
