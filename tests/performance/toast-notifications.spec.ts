import { expect, test } from "@playwright/test";
import { openProjectActions } from "../browser/project-files.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, percentile, ready } from "./app-helpers.ts";

setupAppTests();

test(
	"toast-notifications",
	{ tag: ["@projects"] },
	async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		const times: number[] = [];
		for (let index = 0; index < 3; index++) {
			await openProjectActions(page);
			times.push(
				await interaction(page, "save-notification", async () => {
					await page
						.getByRole("menuitem", { name: "Save project", exact: true })
						.click();
					const dismiss = page.getByRole("button", {
						name: "Dismiss Project saved",
						exact: true,
					});
					await expect(dismiss).toBeVisible();
					await dismiss.click();
					await expect(dismiss).not.toBeVisible();
				}),
			);
		}
		await finish(page, testInfo, "toast-notifications", {
			interactionP95Ms: percentile(times),
		});
	},
);
