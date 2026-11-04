import { expect, test } from "@playwright/test";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("button-shortcuts", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "shortcuts.reveal", async () => {
			await page.keyboard.down("Control");
			await expect(
				page.locator('[data-slot="button-shortcut"]').first(),
			).toBeVisible();
		});
		const hint = page.locator('[data-slot="button-shortcut"][title="Shapes"]');
		const key = await hint.getAttribute("data-shortcut");
		await page.keyboard.press(key!);
		await expect(
			page.getByRole("toolbar", { name: "Shapes toolbar", exact: true }),
		).toBeVisible();
		await page.keyboard.up("Control");
		await expect(page.locator('[data-slot="button-shortcut"]')).toHaveCount(0);
		await page.keyboard.press("Escape");
	}
	const value = await report(page);
	await finish(page, testInfo, "button-shortcuts", {
		interactionP95Ms: metric(value, "scenario.interaction")!,
		hintsP95Ms: metric(value, "ui.button-shortcuts")!,
	});
});
