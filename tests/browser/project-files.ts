import { expect, type Page } from "@playwright/test";

export async function openProjectFiles(page: Page) {
	const sidebar = page.getByRole("complementary", { name: "Project files", exact: true });
	if (!(await sidebar.isVisible())) {
		await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
		await page.mouse.move(20, 300);
		await page.mouse.move(1, 300);
		await expect(sidebar).toBeVisible();
		await expect(sidebar).toHaveCSS("translate", /^0px(?: 0px)?$/);
		await page.mouse.move(100, 300);
	}
	return sidebar;
}

export async function closeProjectFiles(page: Page) {
	const sidebar = page.getByRole("complementary", { name: "Project files", exact: true });
	if (await sidebar.isVisible()) await sidebar.getByRole("button", { name: "Hide project files", exact: true }).click();
	await page.mouse.move(1100, 50);
}
