import { expect, test } from "./seeded-project";

test("debug stats start hidden and follow the setting and the shortcut", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect(page.getByText(".ecadprj")).toBeVisible();
	const stats = page.getByRole("region", { name: "Debug stats" });
	await expect(stats).toBeHidden();

	// The modal settings dialog hides the rest of the page from the
	// accessibility tree, so check the window after closing it.
	const settings = page.getByRole("dialog", { name: "Settings" });
	const toggle = settings.getByRole("checkbox", { name: "Show debug stats" });
	await page.keyboard.press("ControlOrMeta+Comma");
	await expect(toggle).not.toBeChecked();
	await toggle.check();
	await page.keyboard.press("Escape");
	await expect(settings).toBeHidden();
	await expect(stats).toBeVisible();

	await page.keyboard.press("Control+Shift+D");
	await expect(stats).toBeHidden();
	await page.keyboard.press("ControlOrMeta+Comma");
	await expect(toggle).not.toBeChecked();
	await page.keyboard.press("Escape");
	await expect(settings).toBeHidden();

	await page.keyboard.press("Control+Shift+D");
	await expect(stats).toBeVisible();
	await page.reload();
	await expect(stats).toBeVisible();
	await stats.getByRole("button", { name: "Hide debug stats" }).click();
	await expect(stats).toBeHidden();
	await page.reload();
	await expect(page.getByText(".ecadprj")).toBeVisible();
	await expect(stats).toBeHidden();
});
