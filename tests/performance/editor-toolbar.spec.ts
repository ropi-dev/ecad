import { expect, test } from "@playwright/test";
import { toolbarButton } from "../browser/toolbar";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	percentile,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test("editor-toolbar", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Shapes", exact: true }),
	).toBeEnabled();
	for (let repeat = 0; repeat < 3; repeat++) {
		for (const label of ["Shapes", "Connections", "Export"]) {
			await interaction(page, "toolbar.open", async () => {
				await page.getByRole("button", { name: label, exact: true }).click();
				await expect(
					page.getByRole("toolbar", { name: `${label} toolbar`, exact: true }),
				).toBeVisible();
			});
		}
		await interaction(page, "toolbar.choose", async () => {
			await (await toolbarButton(page, "Rectangle")).click();
			await expect(page.locator('[data-tool="rectangle"]')).toBeAttached();
		});
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "Select", exact: true }).click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-toolbar", {
		interactionP95Ms: percentile(
			value.events
				.filter((event) => event.name === "scenario.interaction")
				.map((event) => event.duration),
		),
	});
});
