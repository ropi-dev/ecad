import { expect, test } from "@playwright/test";
import { openProjectFiles } from "./project-files";

test("the sidebar starts hidden, slides in from the edge, and closes after leaving", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	const sidebar = page.getByRole("complementary", { name: "Project files", exact: true });
	const panel = page.locator('aside[aria-label="Project files"]');
	await expect(sidebar).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Show project files", exact: true })).toHaveAttribute("aria-expanded", "false");
	await page.mouse.move(900, 50);
	await page.getByLabel("Project name", { exact: true }).fill("Hover navigation");
	await page.getByRole("button", { name: "Create project", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Hover navigation", exact: true })).toBeVisible();
	await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
	await page.mouse.move(1, 300);
	await page.mouse.move(100, 300);
	await expect(sidebar).toHaveCSS("translate", /^0px(?: 0px)?$/);
	await page.mouse.move(20, 300);
	await expect(sidebar).toBeVisible();
	await page.mouse.move(100, 300);
	await sidebar.getByRole("link", { name: "Schematic editor", exact: true }).click();
	await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
	await page.mouse.move(900, 400);
	await expect(panel).toHaveCSS("opacity", "0");
	await expect(sidebar).toHaveCount(0);
	await page.screenshot({ path: "perf-artifacts/hover-sidebar-hidden-v1.png" });
	await openProjectFiles(page);
	await page.screenshot({ path: "perf-artifacts/hover-sidebar-open-v1.png" });
	await sidebar.getByLabel("Search project files").fill("drawing");
	await page.mouse.move(900, 400);
	await expect(sidebar).toBeVisible();
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await expect(sidebar).toHaveCount(0);
	const trigger = page.getByRole("button", { name: "Show project files", exact: true });
	await trigger.focus();
	await trigger.press("Enter");
	await expect(sidebar).toBeVisible();
	await sidebar.getByRole("button", { name: "Hide project files", exact: true }).press("Enter");
	await expect(trigger).toBeFocused();
	await expect(sidebar).toHaveCount(0);
});

test.describe("touch sidebar", () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	test("the sidebar opens and closes with the touch controls", async ({ page }) => {
		await page.goto("/tests/browser/projects.html");
		const sidebar = page.getByRole("complementary", { name: "Project files", exact: true });
		await expect(sidebar).toHaveCount(0);
		await page.getByRole("button", { name: "Show project files", exact: true }).tap();
		await expect(sidebar).toBeVisible();
		await expect(sidebar).toHaveCSS("translate", /^0px(?: 0px)?$/);
		await page.screenshot({ path: "perf-artifacts/hover-sidebar-touch-v1.png" });
		await sidebar.getByRole("button", { name: "Hide project files", exact: true }).tap();
		await expect(sidebar).toHaveCount(0);
	});
});
