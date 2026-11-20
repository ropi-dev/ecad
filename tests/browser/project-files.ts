import { expect, type Page } from "@playwright/test";
import { required } from "../helpers/required.ts";

async function viewportSize(page: Page) {
	return (
		page.viewportSize() ??
		(await page.evaluate(() => ({
			width: window.innerWidth,
			height: window.innerHeight,
		})))
	);
}

export async function openProjectFiles(page: Page) {
	const sidebar = page.getByRole("complementary", {
		name: "Project files",
		exact: true,
		includeHidden: true,
	});
	await page.waitForFunction(
		() => !document.querySelector('[aria-busy="true"]'),
	);
	// Resting the mouse on the rail reveals the sidebar beside it.
	const y = (await viewportSize(page)).height / 2;
	await page.mouse.move(200, y);
	await page.mouse.move(24, y);
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await expect
		.poll(async () => required(await sidebar.boundingBox()).x)
		.toBe(48);
	await sidebar.hover({ position: { x: 100, y: 20 } });
	return sidebar;
}

export const projectRail = (page: Page) =>
	page.getByRole("navigation", { name: "Sidebar shortcuts", exact: true });

export async function closeProjectFiles(page: Page) {
	const sidebar = page.getByRole("complementary", {
		name: "Project files",
		exact: true,
		includeHidden: true,
	});
	if (!(await sidebar.count())) return;
	await projectRail(page)
		.getByRole("button", { name: "Settings", exact: true })
		.focus();
	await page.keyboard.press("Escape");
	await page.mouse.move((await viewportSize(page)).width - 20, 100);
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await sidebar.evaluate(async (element) => {
		await Promise.all(
			element.getAnimations().map((animation) => animation.finished),
		);
	});
}

export async function openProjectActions(page: Page) {
	await projectRail(page)
		.getByRole("button", { name: "Project actions", exact: true })
		.click();
}

export async function openPrimaryDrawing(page: Page) {
	await (await openProjectFiles(page))
		.getByRole("link", {
			name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/,
			exact: true,
		})
		.click();
}
