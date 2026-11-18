import { captureArtifacts } from "./artifacts";
import { expect, test } from "./seeded-project";

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
		await expect(sidebar).toHaveAttribute("data-open", "false");
		await page.touchscreen.tap(24, 400);
		await expect(sidebar).toHaveAttribute("data-open", "true");
		if (captureArtifacts)
			await page.screenshot({
				path: "perf-artifacts/sidebar-expanded-mobile.png",
			});
		await page.touchscreen.tap(350, 400);
		await expect(sidebar).toHaveAttribute("data-open", "false");
		if (captureArtifacts)
			await page.screenshot({
				path: "perf-artifacts/sidebar-dismissed-mobile.png",
			});
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
	const rail = page.getByRole("navigation", {
		name: "Sidebar shortcuts",
		exact: true,
	});
	await expect(rail).toBeVisible();
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
	await sidebar.evaluate(async (element) => {
		await Promise.all(
			element.getAnimations().map((animation) => animation.finished),
		);
	});
	// Moving from the rail into the sidebar keeps it open.
	await page.mouse.move(150, 400);
	await page.waitForTimeout(600);
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await page.mouse.move(900, 400);
	await expect(sidebar).toHaveAttribute("data-open", "false");
	// A rail menu opens beside the rail and leaves the sidebar closed.
	await rail.getByRole("button", { name: "Add file", exact: true }).click();
	const menu = page.getByRole("menu", { name: "Add file", exact: true });
	await expect(menu).toBeVisible();
	await page.waitForTimeout(400);
	await expect(sidebar).toHaveAttribute("data-open", "false");
	if (captureArtifacts)
		await page.screenshot({ path: "perf-artifacts/sidebar-rail-menu.png" });
	await page.keyboard.press("Escape");
	await expect(menu).toHaveCount(0);
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
