import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configPaths } from "#/main/config-directory.ts";
import { DesktopSettings } from "#/main/settings.ts";

async function withHome(run: (home: string) => Promise<void>) {
	const home = await mkdtemp(join(tmpdir(), "ecad-settings-"));
	try {
		await run(home);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

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
		assert.ok(damaged.error);
		await settings.save(saved);
		assert.deepEqual((await settings.load()).settings, saved);
	}));
