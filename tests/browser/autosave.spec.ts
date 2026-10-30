import { expect, test, type Page } from "@playwright/test";
import { openProjectFiles, closeProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";

async function drawWithTimersPaused(page: Page) {
	await (await toolbarButton(page, "Rectangle")).click();
	await page.clock.install();
	await page.clock.pauseAt(new Date(Date.now() + 100));
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400);
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

test("user-library symbol edits persist while timers are paused", async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			"ecad.user-config.v1",
			JSON.stringify({
				version: 1,
				symbolLibraries: [
					{
						id: "user",
						name: "User",
						enabled: true,
						source: {
							kind: "embedded",
							symbols: [
								{
									format: "ecad-symbol",
									version: 1,
									units: "mm",
									id: "user-part",
									name: "User part",
									description: "",
									prefix: "U",
									value: "",
									shapes: [
										{ kind: "rectangle", x: 0, y: 0, width: 10, height: 6 },
									],
								},
							],
						},
					},
				],
			}),
		);
	});
	await page.goto("/tests/browser/projects.html");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await closeProjectFiles(page);
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert User part", exact: true })
		.click();
	await page.locator("canvas").click({ position: { x: 500, y: 300 } });
	await page.getByRole("button", { name: "Edit symbol", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Symbol editor · User part",
	);
	await drawWithTimersPaused(page);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(localStorage.getItem("ecad.user-config.v1")!)
						.symbolLibraries[0].source.symbols[0].shapes.length,
			),
		)
		.toBe(2);
	await page.clock.resume();
	await page.screenshot({ path: "/tmp/ecad-immediate-save-symbol.png" });
});
