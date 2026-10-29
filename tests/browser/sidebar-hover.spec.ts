import { captureArtifacts } from "./artifacts";
import { expect, test } from "@playwright/test";
import { expectKeyboardNavigation } from "./keyboard-navigation";
import { openProjectFiles } from "./project-files";

test("the add file menu supports keyboard navigation and stays open outside the sidebar", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await page.getByLabel("Project name", { exact: true }).fill("File menu");
	await page
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "File menu", exact: true }),
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
	test("the add file menu fits the touch viewport and creates a symbol", async ({
		page,
	}) => {
		await page.goto("/tests/browser/projects.html");
		await page
			.getByLabel("Project name", { exact: true })
			.fill("Touch file menu");
		await page
			.getByRole("button", { name: "Create project", exact: true })
			.tap();
		await expect(
			page.getByRole("heading", { name: "Touch file menu", exact: true }),
		).toBeVisible();
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
