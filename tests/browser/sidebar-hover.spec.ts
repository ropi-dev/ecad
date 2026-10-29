import { captureArtifacts } from "./artifacts";
import { expect, test } from "@playwright/test";
import { expectKeyboardNavigation } from "./keyboard-navigation";
import { closeProjectFiles, openProjectFiles } from "./project-files";

test("the sidebar slides over the workspace from an invisible edge handle", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
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
		sidebar.getByRole("link", { name: "Gerber viewer", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(sidebar).toHaveAttribute("data-open", "false");
});

test("pinning the sidebar keeps it beside the canvas through navigation", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await closeProjectFiles(page);
	await page.getByLabel("Project name", { exact: true }).fill("Pinned sidebar");
	await page
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	const sidebar = await openProjectFiles(page);
	await sidebar
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	const pin = sidebar.getByRole("button", { name: "Pin sidebar", exact: true });
	await pin.focus();
	await pin.press("Enter");
	await expect(
		sidebar.getByRole("button", { name: "Unpin sidebar", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect
		.poll(async () => (await page.locator("canvas").boundingBox())!.x)
		.toBe(256);
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await page.keyboard.press("Escape");
	await expect(sidebar).toHaveAttribute("data-open", "true");
	if (captureArtifacts)
		await page.screenshot({
			path: "perf-artifacts/sidebar-pinned-desktop.png",
		});
	await sidebar.getByRole("link", { name: "STEP viewer", exact: true }).click();
	await sidebar
		.getByRole("link", { name: "Open Drawing", exact: true })
		.click();
	await expect
		.poll(async () => (await page.locator("canvas").boundingBox())!.x)
		.toBe(256);
	await sidebar
		.getByRole("button", { name: "Unpin sidebar", exact: true })
		.click();
	await expect(sidebar).toHaveAttribute("data-pinned", "false");
	await expect(sidebar).toHaveAttribute("data-open", "true");
	await expect
		.poll(async () => (await page.locator("canvas").boundingBox())!.x)
		.toBe(0);
	if (captureArtifacts)
		await page.screenshot({
			path: "perf-artifacts/sidebar-unpinned-desktop.png",
		});
	await page.mouse.move(900, 400);
	await expect(sidebar).toHaveAttribute("data-open", "false");
});

test("the add file menu supports keyboard navigation and stays open outside the sidebar", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await closeProjectFiles(page);
	await expect(page.getByRole("heading", { name: "Ready when you are", exact: true })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Ready when you are", exact: true }),
	).toBeVisible();
	const sidebar = await openProjectFiles(page);
	const addFile = sidebar.getByRole("button", {
		name: "Add file",
		exact: true,
	});
	await addFile.focus();
	await addFile.press("ArrowDown");
	const menu = page.getByRole("menu", { name: "Add file", exact: true });
	for (const name of ["New drawing", "New symbol", "New circuit"]) {
		await expect(
			menu.getByRole("menuitem", { name, exact: true }),
		).toBeEnabled();
	}
	await expectKeyboardNavigation(
		menu.getByRole("menuitem", { disabled: false }),
		"ArrowDown",
		"ArrowUp",
	);
	await page.mouse.move(350, 150);
	await expect(menu).toBeVisible();
	await expect(sidebar).toBeVisible();
	if (captureArtifacts)
		await page.screenshot({
			path: "perf-artifacts/sidebar-create-file-desktop.png",
		});
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();
	await expect(addFile).toBeFocused();
	await addFile.click();
	await page.mouse.click(900, 400);
	await expect(menu).toBeHidden();
	await openProjectFiles(page);
	await addFile.click();
	await menu
		.getByRole("menuitem", { name: "New drawing", exact: true })
		.click();
	await expect(page.getByLabel("Drawing name", { exact: true })).toBeFocused();
	await page.getByLabel("Drawing name", { exact: true }).fill("Menu drawing");
	await page
		.getByRole("button", { name: "Create drawing", exact: true })
		.click();
	await expect(menu).toBeHidden();
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"Schematic editor · Menu drawing",
	);
	await expect(
		(await openProjectFiles(page)).getByRole("link", {
			name: "Open menu-drawing.ecaddraw",
			exact: true,
		}),
	).toBeVisible();
	const frame = (await sidebar.locator("..").boundingBox())!;
	const canvas = (await page.locator("canvas").boundingBox())!;
	expect(canvas.x).toBeCloseTo(frame.x + frame.width, 1);
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
	test("the add file menu fits the touch viewport and creates a symbol", async ({
		page,
	}) => {
		await page.goto("/tests/browser/projects.html");
		await closeProjectFiles(page);
		await expect(page.getByRole("heading", { name: "Ready when you are", exact: true })).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Ready when you are", exact: true }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Show project files", exact: true })
			.tap();
		await page.getByRole("button", { name: "Add file", exact: true }).tap();
		const menu = page.getByRole("menu", { name: "Add file", exact: true });
		const bounds = (await menu.boundingBox())!;
		expect(bounds.x).toBeGreaterThanOrEqual(12);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(378);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(832);
		if (captureArtifacts)
			await page.screenshot({
				path: "perf-artifacts/sidebar-create-file-mobile.png",
			});
		await menu.getByRole("menuitem", { name: "New symbol", exact: true }).tap();
		await page.getByLabel("Symbol name", { exact: true }).fill("Touch part");
		await page
			.getByRole("button", { name: "Create symbol", exact: true })
			.tap();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Symbol editor · Touch part",
		);
	});
});
