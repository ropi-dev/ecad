import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAntialiasing } from "#/components/viewer/antialiasing.ts";
import { parseProjectManifest } from "#/projects/format.ts";
import {
	type AppSettings,
	parseAppSettings,
	withErcSeverity,
} from "#/settings/schema.ts";
import {
	createBrowserSettingsStorage,
	getAppSettings,
	getSettingsStatus,
	SETTINGS_STORAGE_KEY,
	type SettingsStorage,
	setSettingsStorage,
	updateAppSettings,
} from "#/settings/store.ts";

function fakeStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
	};
}

test("rule levels are set and cleared one rule at a time", () => {
	const settings: AppSettings = { version: 1, antialiasing: "on" };
	const off = withErcSeverity(settings, "unconnected-pin", "off");
	assert.deepEqual(off, {
		...settings,
		ercSeverity: { "unconnected-pin": "off" },
	});
	assert.deepEqual(
		withErcSeverity(off, "unconnected-pin", undefined),
		settings,
	);
	assert.equal(resolveAntialiasing("on"), true);
	assert.equal(resolveAntialiasing("off"), false);
});

test("settings from another build keep unknown keys and drop only invalid fields", () => {
	assert.deepEqual(
		parseAppSettings(
			JSON.stringify({
				version: 1,
				theme: "dark",
				antialiasing: "sometimes",
				ercSeverity: { "unconnected-pin": "off", "similar-net-names": "info" },
			}),
		),
		{ version: 1, theme: "dark", ercSeverity: { "unconnected-pin": "off" } },
	);
	assert.throws(() => parseAppSettings('{"version":2}'), {
		message: /^version: /,
	});
	assert.deepEqual(
		parseProjectManifest(`format = "ecad-project"
version = 1
name = "Rules"
drawing = "drawing.ecaddraw"
symbols = []

[settings]
future = true

[settings.ercSeverity]
unconnected-pin = "off"
`).settings,
		{ future: true, ercSeverity: { "unconnected-pin": "off" } },
	);
});

test("browser settings carry over the old antialiasing key until the next save", async () => {
	const browser = fakeStorage({ "ecad.antialias": "0" });
	setSettingsStorage(createBrowserSettingsStorage(browser));
	assert.equal(getAppSettings().antialiasing, "off");
	assert.equal(getSettingsStatus().location, "in this browser");
	await updateAppSettings((settings) => settings);
	assert.equal(browser.values.has("ecad.antialias"), false);
	assert.deepEqual(JSON.parse(browser.values.get(SETTINGS_STORAGE_KEY) ?? ""), {
		version: 1,
		antialiasing: "off",
	});
});

test("settings apply at once, save in order and report failed reads and saves", async () => {
	const saved: unknown[] = [];
	let fail = false;
	const storage: SettingsStorage = {
		location: "to /config/ecad/settings.json",
		load: () => ({ version: 1 }),
		async save(settings) {
			await new Promise((resolve) => setTimeout(resolve, 5));
			if (fail) throw new Error("Disk full.");
			saved.push(settings);
		},
	};
	setSettingsStorage(storage);
	assert.equal(getSettingsStatus().location, "to /config/ecad/settings.json");
	const first = updateAppSettings((settings) => ({
		...settings,
		antialiasing: "on",
	}));
	const second = updateAppSettings((settings) => ({
		...settings,
		antialiasing: "off",
	}));
	assert.equal(getAppSettings().antialiasing, "off");
	await Promise.all([first, second]);
	assert.deepEqual(saved, [
		{ version: 1, antialiasing: "on" },
		{ version: 1, antialiasing: "off" },
	]);
	fail = true;
	await assert.rejects(
		updateAppSettings((settings) => ({ ...settings, antialiasing: "auto" })),
		/Disk full/,
	);
	assert.equal(getSettingsStatus().error, "Disk full.");
	assert.equal(getAppSettings().antialiasing, "auto");
	await assert.rejects(
		updateAppSettings((settings) => ({
			...settings,
			antialiasing: "sometimes" as never,
		})),
	);
	assert.equal(getAppSettings().antialiasing, "auto");
	setSettingsStorage({
		...storage,
		load: () => {
			throw new Error("Broken file.");
		},
	});
	assert.match(getSettingsStatus().error, /Broken file/);
	assert.deepEqual(getAppSettings(), { version: 1 });
});
