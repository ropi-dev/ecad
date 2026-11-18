import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTheme } from "#/settings/theme.ts";

test("the theme follows the system until one is chosen", () => {
	assert.equal(resolveTheme(undefined, true), "light");
	assert.equal(resolveTheme("system", false), "dark");
	assert.equal(resolveTheme("dark", true), "dark");
	assert.equal(resolveTheme("light", false), "light");
});
