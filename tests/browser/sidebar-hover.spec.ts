import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { captureArtifacts } from "./artifacts";

test("the sidebar slides over the workspace from its button and the left edge", async ({
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
	const frame = sidebar.locator("..");
	const content = frame.locator("+ div");
	await expect(sidebar).toHaveAttribute("data-open", "false");
	expect(required(await frame.boundingBox()).width).toBe(0);
	expect(required(await content.boundingBox()).x).toBe(0);
	await expect
		.poll(async () => required(await sidebar.boundingBox()).x)
		.toBe(-256);
	if (captureArtifacts)
		await page.screenshot({
			path: "perf-artifacts/sidebar-hidden-desktop.png",
		});
	await expect(sidebar).toHaveCSS("transition-duration", "0.2s");
	await expect(sidebar).toHaveCSS("transition-property", /transform/);
	const button = page.getByRole("button", {
		name: "Show project files",
		exact: true,
	});
	// The button opens the sidebar on a click, not on hover.
	await button.hover();
	await page.waitForTimeout(600);
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await expect(button).toBeVisible();
	// Keyboard focus reveals it. This runs before any click, after which a
	// scripted focus no longer counts as keyboard focus.
	await button.focus();
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await page.keyboard.press("Tab");
	await expect(
		sidebar.getByRole("link", { name: "Workspace home", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await button.click();
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await expect
		.poll(async () => required(await sidebar.boundingBox()).x)
		.toBe(0);
	expect(required(await content.boundingBox()).x).toBe(0);
	await sidebar.hover({ position: { x: 100, y: 20 } });
	if (captureArtifacts)
		await page.screenshot({
			path: "perf-artifacts/sidebar-expanded-desktop.png",
		});
	// Opened by a click, it stays until a click outside it.
	await page.mouse.move(900, 400);
	await page.waitForTimeout(600);
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await page.mouse.click(900, 400);
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await expect
		.poll(async () => required(await sidebar.boundingBox()).x)
		.toBe(-256);
	// Resting on the window's left edge reveals the sidebar. Passing over
	// the edge does not.
	await page.mouse.move(2, 400);
	await page.mouse.move(900, 400);
	await page.waitForTimeout(500);
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await page.mouse.move(2, 400);
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await expect
		.poll(async () => required(await sidebar.boundingBox()).x)
		.toBe(0);
	// Straying out for a moment keeps it open; leaving closes it.
	await page.mouse.move(400, 400);
	await page.mouse.move(100, 400);
	await page.waitForTimeout(600);
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await page.mouse.move(900, 400);
	await expect(sidebar).toHaveAttribute("data-open", "false");
});

test("Ctrl+Shift+S toggles pinned and Compact states, including from file search", async ({
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
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await page.keyboard.press("Control+Shift+s");
	await expect(sidebar).toHaveAttribute("data-pinned", "true");
	await expect
		.poll(async () => required(await content.boundingBox()).x)
		.toBe(256);
	const compact = sidebar.getByRole("button", {
		name: "Compact sidebar",
		exact: true,
	});
	// The pin is an icon at the right of the footer, lit while pinned.
	await expect(compact).toHaveAttribute("aria-pressed", "true");
	await expect(compact).toHaveText("");
	// Inside the sidebar's border and footer padding. The sidebar may still be
	// sliding in.
	await expect
		.poll(async () => {
			const box = required(await compact.boundingBox());
			return box.x + box.width;
		})
		.toBe(256 - 1 - 8);
	await expect(compact).toHaveAttribute("aria-keyshortcuts", "Control+Shift+S");
	await page.locator("body").dispatchEvent("keydown", {
		code: "KeyS",
		key: "s",
		ctrlKey: true,
		shiftKey: true,
		repeat: true,
	});
	await expect(sidebar).toHaveAttribute("data-pinned", "true");
	await sidebar.getByLabel("Search project files").focus();
	await page.keyboard.press("Control+Shift+s");
	await expect(sidebar).toHaveAttribute("data-pinned", "false");
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await expect
		.poll(async () => required(await content.boundingBox()).x)
		.toBe(0);
	await page.mouse.move(2, 400);
	await expect(
		sidebar.getByRole("button", { name: "Pin sidebar", exact: true }),
	).toHaveAttribute("aria-pressed", "false");
});

test.describe("touch sidebar", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	});
	test("the sidebar button opens the sidebar on touch", async ({ page }) => {
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
		expect(required(await content.boundingBox()).width).toBe(390);
		await page
			.getByRole("button", { name: "Show project files", exact: true })
			.tap();
		await expect(sidebar).toHaveAttribute("data-open", "true");
		await expect
			.poll(async () => required(await sidebar.boundingBox()).x)
			.toBe(0);
		expect(required(await content.boundingBox()).width).toBe(390);
		if (captureArtifacts)
			await page.screenshot({
				path: "perf-artifacts/sidebar-expanded-mobile.png",
			});
		await page.touchscreen.tap(350, 400);
		await expect(sidebar).toHaveAttribute("data-open", "false");
		await expect
			.poll(async () => required(await sidebar.boundingBox()).x)
			.toBe(-256);
		if (captureArtifacts)
			await page.screenshot({
				path: "perf-artifacts/sidebar-dismissed-mobile.png",
			});
		await page
			.getByRole("button", { name: "Show project files", exact: true })
			.tap();
		await expect(sidebar).toHaveAttribute("data-open", "true");
		await sidebar
			.getByRole("button", { name: "Pin sidebar", exact: true })
			.tap();
		await expect
			.poll(async () => required(await content.boundingBox()).x)
			.toBe(256);
		expect(required(await content.boundingBox()).width).toBe(134);
		await page.touchscreen.tap(350, 400);
		await expect(sidebar).toHaveAttribute("data-open", "true");
		if (captureArtifacts)
			await page.screenshot({
				path: "perf-artifacts/sidebar-pinned-mobile.png",
			});
		await sidebar
			.getByRole("button", { name: "Compact sidebar", exact: true })
			.tap();
		await expect(sidebar).toHaveAttribute("data-open", "false");
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page
			.getByRole("button", { name: "Show project files", exact: true })
			.tap();
		await expect(sidebar).toHaveCSS("transition-property", "none");
		expect(
			await sidebar.evaluate((element) => element.getAnimations().length),
		).toBe(0);
	});
});
