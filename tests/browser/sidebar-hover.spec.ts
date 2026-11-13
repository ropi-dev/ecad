import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { captureArtifacts } from "./artifacts";
import { openProjectFiles, projectRail } from "./project-files";

test("opening a file closes the sidebar", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	const sidebar = await openProjectFiles(page);
	const drawing = sidebar.getByRole("link", {
		name: "Open Untitled.ecaddraw",
		exact: true,
	});
	await drawing.click();
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await expect(
		page.getByRole("heading", { level: 1, name: /^Schematic editor/ }),
	).toBeVisible();
	await openProjectFiles(page);
	await sidebar
		.getByRole("link", {
			name: "Open Untitled.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await page
		.getByRole("navigation", { name: "Sidebar shortcuts", exact: true })
		.click({ position: { x: 24, y: 400 } });
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await drawing.click();
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await expect(page.getByTestId("sidebar-backdrop")).toHaveCount(0);
});

test("Escape before the Add file menu's first frame returns focus to the rail and leaves the sidebar closed", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	const sidebar = page.getByRole("complementary", {
		name: "Project files",
		exact: true,
		includeHidden: true,
	});
	const add = projectRail(page).getByRole("button", {
		name: "Add file",
		exact: true,
	});
	await page.addStyleTag({ content: ".ui-popover { animation-delay: 1s; }" });
	await add.click();
	await expect(page.getByRole("menu")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menu")).toHaveCount(0);
	await expect(add).toBeFocused();
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await expect(sidebar.getByRole("button", { name: "Add file" })).toHaveCount(
		0,
	);
});

test.describe("touch sidebar", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	});
	test("a tap on the rail opens the sidebar on touch", async ({ page }) => {
		await page.goto("/tests/browser/projects.html");
		await expect(
			page.getByLabel("Workspace instructions", { exact: true }),
		).toBeVisible();
		const sidebar = page.getByRole("complementary", {
			name: "Project files",
			exact: true,
			includeHidden: true,
		});
		const content = sidebar.locator("..").locator("+ div");
		await expect(sidebar).toHaveAttribute("data-open", "false");
		expect(required(await content.boundingBox()).width).toBe(342);
		await page.touchscreen.tap(24, 400);
		await expect(sidebar).toHaveAttribute("data-open", "true");
		await expect
			.poll(async () => required(await sidebar.boundingBox()).x)
			.toBe(48);
		expect(required(await content.boundingBox()).width).toBe(342);
		if (captureArtifacts)
			await page.screenshot({
				path: "perf-artifacts/sidebar-expanded-mobile.png",
			});
		await page.touchscreen.tap(350, 400);
		await expect(sidebar).toHaveAttribute("data-open", "false");
		await expect
			.poll(async () => required(await sidebar.boundingBox()).x)
			.toBe(-208);
		if (captureArtifacts)
			await page.screenshot({
				path: "perf-artifacts/sidebar-dismissed-mobile.png",
			});
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.touchscreen.tap(24, 400);
		await expect(sidebar).toHaveCSS("transition-property", "none");
		expect(
			await sidebar.evaluate((element) => element.getAnimations().length),
		).toBe(0);
	});
});

test("the sidebar keeps an icon rail beside the workspace and slides out beside it", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
	await page.mouse.move(900, 400);
	const sidebar = page.getByRole("complementary", {
		name: "Project files",
		exact: true,
		includeHidden: true,
	});
	const content = sidebar.locator("..").locator("+ div");
	const rail = page.getByRole("navigation", {
		name: "Sidebar shortcuts",
		exact: true,
	});
	await expect(rail).toBeVisible();
	expect(required(await rail.boundingBox())).toMatchObject({ x: 0, width: 48 });
	expect(required(await content.boundingBox()).x).toBe(48);
	await expect
		.poll(async () => required(await sidebar.boundingBox()).x)
		.toBe(-208);
	await expect(sidebar).toHaveCSS("transition-duration", "0.12s");
	await expect(sidebar).toHaveCSS("transition-property", /transform/);
	// The sidebar cannot be pinned, and its panel has no footer of buttons.
	await expect(
		page.getByRole("button", { name: "Pin sidebar", includeHidden: true }),
	).toHaveCount(0);
	await expect(
		sidebar.getByRole("button", { name: "Settings", includeHidden: true }),
	).toHaveCount(0);
	expect(
		required(
			await page
				.getByRole("group", { name: "Document", exact: true })
				.boundingBox(),
		).x,
	).toBe(58);
	if (captureArtifacts)
		await page.screenshot({ path: "perf-artifacts/sidebar-compact.png" });
	// Keyboard focus on the rail reveals the sidebar. This runs before any
	// click, after which a scripted focus no longer counts as keyboard focus.
	await rail.getByRole("button", { name: "Add file", exact: true }).focus();
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await page.keyboard.press("Escape");
	await expect(sidebar).toHaveAttribute("data-open", "false");
	// The pointer reaching the rail slides the sidebar out beside it at once.
	await page.mouse.move(24, 400);
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await expect
		.poll(async () => required(await sidebar.boundingBox()).x)
		.toBe(48);
	await expect(rail).toBeVisible();
	expect(required(await content.boundingBox()).x).toBe(48);
	// Moving from the rail into the sidebar keeps it open.
	await page.mouse.move(150, 400);
	await page.waitForTimeout(600);
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await page.mouse.move(900, 400);
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await page.mouse.move(24, 400);
	await expect
		.poll(async () => required(await sidebar.boundingBox()).x)
		.toBe(48);
	if (captureArtifacts)
		await page.screenshot({ path: "perf-artifacts/sidebar-compact-open.png" });
	await page.mouse.move(900, 400);
	await expect(sidebar).toHaveAttribute("data-open", "false");
	// The rail's menus open beside it and leave the sidebar closed.
	for (const name of ["Add file", "Open project", "Project actions"]) {
		await rail.getByRole("button", { name, exact: true }).click();
		const menu = page.getByRole("menu", { name, exact: true });
		await expect(menu).toBeVisible();
		expect(required(await menu.boundingBox()).x).toBeGreaterThan(48);
		await page.waitForTimeout(400);
		await expect(sidebar).toHaveAttribute("data-open", "false");
		if (captureArtifacts && name === "Add file")
			await page.screenshot({ path: "perf-artifacts/sidebar-rail-menu.png" });
		await page.keyboard.press("Escape");
		await expect(menu).toHaveCount(0);
	}
	// A file created from the rail opens without the sidebar.
	await rail.getByRole("button", { name: "Add file", exact: true }).click();
	await page
		.getByRole("menuitem", { name: "New drawing", exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await dialog.getByRole("textbox").fill("Rail drawing");
	await dialog.getByRole("textbox").press("Enter");
	await expect(dialog).toHaveCount(0);
	await expect(
		page.getByRole("heading", { level: 1, name: /^Schematic editor/ }),
	).toBeVisible();
	await expect(sidebar).toHaveAttribute("data-open", "false");
	// Settings opened from the rail leaves the sidebar closed.
	await rail.getByRole("button", { name: "Settings", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
});
