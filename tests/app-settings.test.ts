import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAntialiasing } from "#/components/viewer/antialiasing.ts";
import { type AppSettings, withErcSeverity } from "#/settings/schema.ts";
import {
	getAppSettings,
	getSettingsStatus,
	type SettingsStorage,
	setSettingsStorage,
	updateAppSettings,
} from "#/settings/store.ts";

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

test("settings apply at once, save in order and report failed reads and saves", async () => {
	const saved: unknown[] = [];
	let fail = false;
	const storage: SettingsStorage = {
		load: () => ({ version: 1 }),
		async save(settings) {
			await new Promise((resolve) => setTimeout(resolve, 5));
			if (fail) throw new Error("Disk full.");
			saved.push(settings);
		},
	};
	setSettingsStorage(storage);
	assert.equal(getSettingsStatus().error, "");
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
