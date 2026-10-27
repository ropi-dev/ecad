import { expect, test } from "@playwright/test";
import { openProjectFiles } from "./project-files";

test("the sidebar stays in the layout and keeps its rail controls usable", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	const sidebar = page.getByRole("complementary", { name: "Project files", exact: true });
	const frame = sidebar.locator("..");
	const content = frame.locator("+ div");
	await expect(sidebar).toHaveAttribute("data-open", "false");
	const rail = (await frame.boundingBox())!;
	expect(rail).toEqual({ x: 0, y: 0, width: 48, height: page.viewportSize()!.height });
	expect((await content.boundingBox())!.x).toBe(48);
	const toggle = sidebar.getByRole("button", { name: "Show project files", exact: true });
	const toggleBounds = (await toggle.boundingBox())!;
	expect(toggleBounds.y + toggleBounds.height).toBeGreaterThan(rail.height - 12);
	const links = await sidebar.getByRole("navigation", { name: "Workspaces" }).getByRole("link").all();
	const bounds = await Promise.all(links.map(link => link.boundingBox()));
	for (let index = 0; index < bounds.length; index++) {
		expect(bounds[index]!.x).toBeGreaterThanOrEqual(0);
		expect(bounds[index]!.x + bounds[index]!.width).toBeLessThanOrEqual(48);
		if (index) expect(bounds[index]!.y).toBeGreaterThan(bounds[index - 1]!.y);
	}
	await sidebar.getByRole("link", { name: "Schematic editor", exact: true }).hover();
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await page.getByLabel("Project name", { exact: true }).fill("Rail navigation");
	await page.getByRole("button", { name: "Create project", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Rail navigation", exact: true })).toBeVisible();
	await sidebar.getByRole("link", { name: "Schematic editor", exact: true }).click();
	await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
	await expect(sidebar.getByRole("button", { name: "Enable MCP", exact: true })).toBeEnabled();
	await expect(sidebar.getByRole("link", { name: "Open Drawing", exact: true })).toBeVisible();
	await expect(sidebar.getByRole("link", { name: "Open Drawing", exact: true })).toHaveAttribute("title", "Drawing · Drawing");
	await page.screenshot({ path: "perf-artifacts/sidebar-rail-desktop.png" });
	await toggle.focus();
	await frame.evaluate(element => {
		element.addEventListener("transitionrun", () => {
			for (const animation of element.getAnimations()) {
				animation.pause();
				animation.currentTime = 100;
			}
		}, { once: true });
	});
	await toggle.press("Enter");
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await expect(sidebar.getByRole("button", { name: "Hide project files", exact: true })).toBeFocused();
	const duringOpening = (await frame.boundingBox())!;
	expect(duringOpening.width).toBeGreaterThan(48);
	expect(duringOpening.width).toBeLessThan(256);
	expect((await content.boundingBox())!.x).toBe(duringOpening.width);
	await page.screenshot({ path: "perf-artifacts/sidebar-transition-desktop.png" });
	await frame.evaluate(element => element.getAnimations().forEach(animation => animation.play()));
	await expect.poll(async () => (await content.boundingBox())!.x).toBe(256);
	await expect.poll(async () => (await page.locator("canvas").boundingBox())!.x).toBe(256);
	await sidebar.getByLabel("Search project files").fill("drawing");
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await page.screenshot({ path: "perf-artifacts/sidebar-expanded-desktop.png" });
	await sidebar.getByRole("button", { name: "Hide project files", exact: true }).press("Enter");
	await expect(toggle).toBeFocused();
	await expect.poll(async () => (await content.boundingBox())!.x).toBe(48);
	await expect.poll(async () => (await page.locator("canvas").boundingBox())!.x).toBe(48);
	await openProjectFiles(page);
	await expect(sidebar.getByLabel("Search project files")).toHaveValue("drawing");
});

test("the add file menu supports keyboard navigation and stays open outside the sidebar", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await page.getByLabel("Project name", { exact: true }).fill("File menu");
	await page.getByRole("button", { name: "Create project", exact: true }).click();
	await expect(page.getByRole("heading", { name: "File menu", exact: true })).toBeVisible();
	const sidebar = await openProjectFiles(page);
	const addFile = sidebar.getByRole("button", { name: "Add file", exact: true });
	await addFile.focus();
	await addFile.press("ArrowDown");
	const menu = page.getByRole("menu", { name: "Add file", exact: true });
	await expect(menu.getByRole("menuitem")).toHaveText([
		"New drawing",
		"New symbol",
	]);
	await expect(menu.getByRole("menuitem", { name: "New drawing", exact: true })).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(menu.getByRole("menuitem", { name: "New symbol", exact: true })).toBeFocused();
	await page.mouse.move(350, 150);
	await expect(menu).toBeVisible();
	await expect(sidebar).toBeVisible();
	await page.screenshot({ path: "perf-artifacts/sidebar-create-file-desktop.png" });
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();
	await expect(addFile).toBeFocused();
	await addFile.click();
	await page.mouse.click(900, 400);
	await expect(menu).toBeHidden();
	await openProjectFiles(page);
	await addFile.click();
	await menu.getByRole("menuitem", { name: "New drawing", exact: true }).click();
	await expect(page.getByLabel("Drawing name", { exact: true })).toBeFocused();
	await page.getByLabel("Drawing name", { exact: true }).fill("Menu drawing");
	await page.getByRole("button", { name: "Create drawing", exact: true }).click();
	await expect(menu).toBeHidden();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Schematic editor · Menu drawing");
	await expect((await openProjectFiles(page)).getByRole("link", { name: "Open menu-drawing.ecaddraw", exact: true })).toBeVisible();
});

test.describe("touch sidebar", () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	test("the sidebar resizes the touch workspace using its bottom toggle", async ({ page }) => {
		await page.goto("/tests/browser/projects.html");
		const sidebar = page.getByRole("complementary", { name: "Project files", exact: true });
		const frame = sidebar.locator("..");
		const content = frame.locator("+ div");
		await expect(sidebar).toHaveAttribute("data-open", "false");
		expect((await frame.boundingBox())!).toEqual({ x: 0, y: 0, width: 48, height: 844 });
		expect((await content.boundingBox())!).toEqual({ x: 48, y: 0, width: 342, height: 844 });
		await page.screenshot({ path: "perf-artifacts/sidebar-rail-mobile.png" });
		await sidebar.getByRole("button", { name: "Show project files", exact: true }).tap();
		await expect(sidebar).toHaveAttribute("data-open", "true");
		await expect(frame).toHaveCSS("width", "256px");
		expect((await frame.boundingBox())!).toEqual({ x: 0, y: 0, width: 256, height: 844 });
		expect((await content.boundingBox())!).toEqual({ x: 256, y: 0, width: 134, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
		await page.screenshot({ path: "perf-artifacts/sidebar-expanded-mobile.png" });
		await sidebar.getByRole("button", { name: "Hide project files", exact: true }).tap();
		await expect(sidebar).toHaveAttribute("data-open", "false");
		await expect(frame).toHaveCSS("width", "48px");
		expect((await content.boundingBox())!.width).toBe(342);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await sidebar.getByRole("button", { name: "Show project files", exact: true }).tap();
		await expect(frame).toHaveCSS("transition-property", "none");
		expect((await frame.boundingBox())!.width).toBe(256);
		expect(await frame.evaluate(element => element.getAnimations().length)).toBe(0);
	});
	test("the add file menu fits the touch viewport and creates a symbol", async ({ page }) => {
		await page.goto("/tests/browser/projects.html");
		await page.getByLabel("Project name", { exact: true }).fill("Touch file menu");
		await page.getByRole("button", { name: "Create project", exact: true }).tap();
		await expect(page.getByRole("heading", { name: "Touch file menu", exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Add file", exact: true }).tap();
		const menu = page.getByRole("menu", { name: "Add file", exact: true });
		const bounds = (await menu.boundingBox())!;
		expect(bounds.x).toBeGreaterThanOrEqual(12);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(378);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(832);
		await page.screenshot({ path: "perf-artifacts/sidebar-create-file-mobile.png" });
		await menu.getByRole("menuitem", { name: "New symbol", exact: true }).tap();
		await page.getByLabel("Symbol name", { exact: true }).fill("Touch part");
		await page.getByRole("button", { name: "Create symbol", exact: true }).tap();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Touch part");
	});
});
