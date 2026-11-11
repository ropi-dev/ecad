import { expect, test } from "@playwright/test";

test("Ctrl+, opens settings and Escape closes them", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	const settings = page.getByRole("dialog", { name: "Settings" });
	await expect(page.getByText(".ecadprj")).toBeVisible();
	await page.keyboard.press("ControlOrMeta+Comma");
	await expect(settings).toBeVisible();
	await expect(
		settings.getByRole("tab", { name: "Display", selected: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(settings).toBeHidden();
});
