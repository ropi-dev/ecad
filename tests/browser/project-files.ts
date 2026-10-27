import { expect, type Page } from "@playwright/test";

export async function openProjectFiles(page: Page) {
	const sidebar = page.getByRole("complementary", { name: "Project files", exact: true });
	await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
	const expand = sidebar.getByRole("button", { name: "Show project files", exact: true });
	if (await expand.isVisible()) await expand.click();
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await sidebar.locator("..").evaluate(async (element) => {
		await Promise.all(element.getAnimations().map((animation) => animation.finished));
	});
	return sidebar;
}

export async function closeProjectFiles(page: Page) {
	const sidebar = page.getByRole("complementary", { name: "Project files", exact: true });
	if (!(await sidebar.count())) return;
	const collapse = sidebar.getByRole("button", { name: "Hide project files", exact: true });
	if (await collapse.isVisible()) await collapse.click();
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await sidebar.locator("..").evaluate(async (element) => {
		await Promise.all(element.getAnimations().map((animation) => animation.finished));
	});
}
