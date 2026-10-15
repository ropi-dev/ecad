import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(
		page.getByRole("button", { name: "Shapes", exact: true }),
	).toBeEnabled();
});

test("groups replace each other above the main toolbar without changing the active tool", async ({
	page,
}) => {
	const main = page.getByRole("toolbar", {
		name: "View controls",
		exact: true,
	});
	await expect(main.getByRole("button")).toHaveCount(9);
	await expect(
		page.getByRole("button", { name: "Rectangle", exact: true }),
	).toHaveCount(0);
	const shapes = page.getByRole("button", { name: "Shapes", exact: true });
	await shapes.click();
	const secondary = page.getByRole("toolbar", { name: "Shapes toolbar" });
	await expect(secondary.getByRole("button")).toHaveCount(5);
	const mainBox = (await main.boundingBox())!;
	const secondaryBox = (await secondary.boundingBox())!;
	expect(secondaryBox.y + secondaryBox.height).toBeLessThan(mainBox.y);
	await page.getByRole("button", { name: "Circle", exact: true }).click();
	await expect(shapes).toHaveAttribute("data-active", "true");
	await page.getByRole("button", { name: "Connections", exact: true }).click();
	await expect(secondary).toHaveCount(0);
	await expect(
		page
			.getByRole("toolbar", { name: "Connections toolbar" })
			.getByRole("button"),
	).toHaveCount(2);
	await expect(page.locator('[data-tool="circle"]')).toBeAttached();
	await shapes.click();
	await expect(
		page.getByRole("button", { name: "Circle", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await shapes.click();
	await expect(shapes).toHaveAttribute("aria-expanded", "false");
});

test("keyboard opening, tool navigation, and Escape restore focus", async ({
	page,
}) => {
	const shapes = page.getByRole("button", { name: "Shapes", exact: true });
	await shapes.focus();
	await page.keyboard.press("ArrowUp");
	await expect(
		page.getByRole("button", { name: "Rectangle", exact: true }),
	).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect(
		page.getByRole("button", { name: "Circle", exact: true }),
	).toBeFocused();
	await page.keyboard.press("End");
	await expect(
		page.getByRole("button", { name: "Text", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Home");
	await page.keyboard.press("Enter");
	await expect(page.locator('[data-tool="rectangle"]')).toBeAttached();
	await page.keyboard.press("Escape");
	await expect(shapes).toBeFocused();
	await expect(shapes).toHaveAttribute("aria-expanded", "false");
});

test("drawing dismisses the group and history actions still undo the edit", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Shapes", exact: true }).click();
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
	const box = (await page.locator("canvas").boundingBox())!;
	await page.mouse.move(box.width / 2, box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.width / 2 + 80, box.height / 2 + 60);
	await page.mouse.up();
	await expect(
		page.getByRole("button", { name: "Shapes", exact: true }),
	).toHaveAttribute("aria-expanded", "false");
	await page
		.getByRole("button", { name: "History tools", exact: true })
		.click();
	const undo = page.getByRole("button", { name: "Undo", exact: true });
	await expect(undo).toBeEnabled();
	await undo.click();
	await expect(undo).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "Redo", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "History", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "Drawing history", exact: true }),
	).toBeVisible();
});

for (const width of [320, 390, 1440]) {
	test(`toolbars stay within a ${width}px viewport`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		for (const label of [
			"Shapes",
			"Connections",
			"History tools",
			"View tools",
		]) {
			await page.getByRole("button", { name: label, exact: true }).click();
			const mainBox = (await page
				.getByRole("toolbar", { name: "View controls", exact: true })
				.boundingBox())!;
			const secondaryBox = (await page
				.getByRole("toolbar", { name: `${label} toolbar` })
				.boundingBox())!;
			for (const box of [mainBox, secondaryBox]) {
				expect(box.x).toBeGreaterThanOrEqual(0);
				expect(box.x + box.width).toBeLessThanOrEqual(width);
			}
			expect(secondaryBox.y + secondaryBox.height).toBeLessThan(mainBox.y);
		}
		await page.getByRole("button", { name: "Shapes", exact: true }).click();
		await page.screenshot({
			path: test.info().outputPath("grouped-toolbar.png"),
		});
	});
}
