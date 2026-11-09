import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("button-shortcuts", { tag: ["@editor"] }, async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	for (let repeat = 0; repeat < 3; repeat++) {
		// Hints appear only after Ctrl is held for 1 s, so the timed interaction
		// starts once they are up and covers activating a group and rebuilding them.
		await page.keyboard.down("Control");
		const hint = page.locator('[data-slot="button-shortcut"][title="Shapes"]');
		await expect(hint).toBeVisible();
		const key = await hint.getAttribute("data-shortcut");
		await interaction(page, "shortcuts.activate", async () => {
			await page.keyboard.press(required(key));
			await expect(
				page.getByRole("toolbar", { name: "Shapes toolbar", exact: true }),
			).toBeVisible();
			await expect(
				page.locator('[data-slot="button-shortcut"][title="Rectangle"]'),
			).toBeVisible();
		});
		await page.keyboard.up("Control");
		await expect(page.locator('[data-slot="button-shortcut"]')).toHaveCount(0);
		await page.keyboard.press("Escape");
	}
	const value = await report(page);
	await finish(page, testInfo, "button-shortcuts", {
		interactionP95Ms: required(metric(value, "scenario.interaction")),
		hintsP95Ms: required(metric(value, "ui.button-shortcuts")),
	});
});
