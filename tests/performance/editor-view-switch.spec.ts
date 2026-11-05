import { expect, test } from "@playwright/test";
import { closeProjectFiles } from "../browser/project-files";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	openCircuitWorkload,
	percentile,
	ready,
} from "./app-helpers.ts";

setupAppTests();

test(
	"editor-view-switch",
	{ tag: ["@editor", "@circuit"] },
	async ({ page }, testInfo) => {
		await openCircuitWorkload(page);
		// The first switch moves the hand-written fixture into the current project
		// layout, and the editor then returns to the circuit view. Let that finish
		// and reload so every measured switch starts from a saved project.
		await page
			.getByRole("button", { name: "Switch to schematic view", exact: true })
			.click();
		await page.waitForURL(/file=pcbs%2F.*view=circuit/);
		await expect(page.locator(".circuit-editor")).toHaveAttribute(
			"data-pending-changes",
			"false",
		);
		const url = new URL(page.url());
		url.searchParams.set("perf", "1");
		await page.goto(url.toString());
		await ready(page);
		await expect(page.locator(".circuit-component")).toHaveCount(32);
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
						.getByRole("button", {
							name: "Switch to circuit view",
							exact: true,
						})
						.click();
					await expect(page.locator(".circuit-component")).toHaveCount(32);
				}),
			);
		}
		await finish(page, testInfo, "editor-view-switch", {
			interactionP95Ms: percentile(times),
		});
	},
);
