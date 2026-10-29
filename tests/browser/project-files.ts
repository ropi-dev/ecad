import { expect, type Page } from "@playwright/test";

export async function openProjectFiles(page: Page) {
	const sidebar = page.getByRole("complementary", {
		name: "Project files",
		exact: true,
		includeHidden: true,
	});
	await page.waitForFunction(
		() => !document.querySelector('[aria-busy="true"]'),
	);
	const expand = page.getByRole("button", {
		name: "Show project files",
		exact: true,
		includeHidden: true,
	});
	await expand.hover();
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await expect.poll(async () => (await sidebar.boundingBox())!.x).toBe(0);
	await sidebar.hover({ position: { x: 100, y: 20 } });
	return sidebar;
}

export async function closeProjectFiles(page: Page) {
	const sidebar = page.getByRole("complementary", {
		name: "Project files",
		exact: true,
		includeHidden: true,
	});
	if (!(await sidebar.count())) return;
	const unpin = sidebar.getByRole("button", {
		name: "Unpin sidebar",
		exact: true,
	});
	if (await unpin.isVisible()) await unpin.click();
	await page
		.getByRole("button", { name: "Show project files", exact: true })
		.focus();
	await page.keyboard.press("Escape");
	await page.mouse.move(page.viewportSize()!.width - 20, 100);
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await sidebar.evaluate(async (element) => {
		await Promise.all(
			element.getAnimations().map((animation) => animation.finished),
		);
	});
}
