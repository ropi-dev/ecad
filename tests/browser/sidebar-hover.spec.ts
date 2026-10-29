import { captureArtifacts } from "./artifacts";
import { expect, test } from "@playwright/test";

test("the sidebar slides over the workspace from an invisible edge handle", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect(page.getByRole("heading", { name: "Ready when you are", exact: true })).toBeVisible();
	await page.mouse.move(900, 400);
	const sidebar = page.getByRole("complementary", {
		name: "Project files",
		exact: true,
		includeHidden: true,
	});
	const frame = sidebar.locator("..");
	const content = frame.locator("+ div");
	await expect(sidebar).toHaveAttribute("data-open", "false");
	expect((await frame.boundingBox())!.width).toBe(0);
	expect((await content.boundingBox())!.x).toBe(0);
	await expect.poll(async () => (await sidebar.boundingBox())!.x).toBe(-256);
	if (captureArtifacts)
		await page.screenshot({
			path: "perf-artifacts/sidebar-hidden-desktop.png",
		});
	await expect(sidebar).toHaveCSS("transition-duration", "0.2s");
	await expect(sidebar).toHaveCSS("transition-property", /transform/);
	await page
		.getByRole("button", { name: "Show project files", exact: true })
		.hover();
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await expect.poll(async () => (await sidebar.boundingBox())!.x).toBe(0);
	expect((await content.boundingBox())!.x).toBe(0);
	await sidebar.hover({ position: { x: 100, y: 20 } });
	if (captureArtifacts)
		await page.screenshot({
			path: "perf-artifacts/sidebar-expanded-desktop.png",
		});
	await page.mouse.move(900, 400);
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await expect.poll(async () => (await sidebar.boundingBox())!.x).toBe(-256);
	await page
		.getByRole("button", { name: "Show project files", exact: true })
		.focus();
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await page.keyboard.press("Tab");
	await expect(
		sidebar.getByRole("button", { name: "Add file", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(sidebar).toHaveAttribute("data-open", "false");
});

test.describe("touch sidebar", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	});
	test("the invisible edge handle opens the sidebar on touch", async ({
		page,
	}) => {
		await page.goto("/tests/browser/projects.html");
		await expect(page.getByRole("heading", { name: "Ready when you are", exact: true })).toBeVisible();
		const sidebar = page.getByRole("complementary", {
			name: "Project files",
			exact: true,
			includeHidden: true,
		});
		const content = sidebar.locator("..").locator("+ div");
		await expect(sidebar).toHaveAttribute("data-open", "false");
		expect((await content.boundingBox())!.width).toBe(390);
		await page
			.getByRole("button", { name: "Show project files", exact: true })
			.tap();
		await expect(sidebar).toHaveAttribute("data-open", "true");
		await expect.poll(async () => (await sidebar.boundingBox())!.x).toBe(0);
		expect((await content.boundingBox())!.width).toBe(390);
		if (captureArtifacts)
			await page.screenshot({
				path: "perf-artifacts/sidebar-expanded-mobile.png",
			});
		await page.touchscreen.tap(350, 400);
		await expect(sidebar).toHaveAttribute("data-open", "false");
		await expect.poll(async () => (await sidebar.boundingBox())!.x).toBe(-256);
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
		await expect.poll(async () => (await content.boundingBox())!.x).toBe(256);
		expect((await content.boundingBox())!.width).toBe(134);
		await page.touchscreen.tap(350, 400);
		await expect(sidebar).toHaveAttribute("data-open", "true");
		if (captureArtifacts)
			await page.screenshot({
				path: "perf-artifacts/sidebar-pinned-mobile.png",
			});
		await sidebar
			.getByRole("button", { name: "Unpin sidebar", exact: true })
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
