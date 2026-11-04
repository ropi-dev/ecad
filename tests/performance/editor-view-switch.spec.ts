import { expect, test } from "@playwright/test";
import { closeProjectFiles } from "../browser/project-files";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	openCircuitWorkload,
	percentile,
} from "./app-helpers.ts";

setupAppTests();

test("editor-view-switch", async ({ page }, testInfo) => {
	await openCircuitWorkload(page);
	await closeProjectFiles(page);
	const times: number[] = [];
	for (let index = 0; index < 3; index++) {
		times.push(
			await interaction(page, "switch-to-schematic", async () => {
				await page
					.getByRole("button", {
						name: "Switch to schematic view",
						exact: true,
					})
					.click();
				await expect(
					page.getByRole("button", { name: "Symbols", exact: true }),
				).toBeEnabled();
			}),
		);
		times.push(
			await interaction(page, "switch-to-circuit", async () => {
				await page
					.getByRole("button", { name: "Switch to circuit view", exact: true })
					.click();
				await expect(page.locator(".circuit-component")).toHaveCount(32);
			}),
		);
	}
	await finish(page, testInfo, "editor-view-switch", {
		interactionP95Ms: percentile(times),
	});
});
