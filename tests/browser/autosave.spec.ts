import type { Page } from "@playwright/test";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { expect, test } from "./seeded-project";
import { toolbarButton } from "./toolbar";

async function drawWithTimersPaused(page: Page) {
	await (await toolbarButton(page, "Rectangle")).click();
	await page.clock.install();
	await page.clock.pauseAt(new Date(Date.now() + 100));
	// Span several 50 mil grid cells even when a small symbol fills the view.
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(1000, 500);
	await page.mouse.up();
}

test("schematic edits persist while timers are paused", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await closeProjectFiles(page);
	await expect(page.locator("canvas")).toBeVisible();
	await drawWithTimersPaused(page);
	await expect
		.poll(async () => {
			return page.evaluate(async () => {
				const modulePath = "/packages/web/src/projects/storage.ts";
				const { createWebProjectStorage } = await import(modulePath);
				return (await createWebProjectStorage().load())?.shapes.length;
			});
		})
		.toBe(1);
	await page.clock.resume();
});
