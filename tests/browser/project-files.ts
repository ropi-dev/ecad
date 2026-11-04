import { expect, type Page } from "@playwright/test";
import { required } from "../helpers/required.ts";

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
	await expect
		.poll(async () => required(await sidebar.boundingBox()).x)
		.toBe(0);
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
		name: "Compact sidebar",
		exact: true,
	});
	if (await unpin.isVisible()) await unpin.click();
	await page
		.getByRole("button", { name: "Show project files", exact: true })
		.focus();
	await page.keyboard.press("Escape");
	await page.mouse.move(required(page.viewportSize()).width - 20, 100);
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await sidebar.evaluate(async (element) => {
		await Promise.all(
			element.getAnimations().map((animation) => animation.finished),
		);
	});
}

export async function openProjectActions(page: Page) {
	const sidebar = await openProjectFiles(page);
	await sidebar
		.getByRole("button", { name: "Project actions", exact: true })
		.click();
}
