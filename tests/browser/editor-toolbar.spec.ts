import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(
		page.getByRole("button", { name: "Shapes", exact: true }),
	).toBeEnabled();
});

test("tooltips show shortcuts on hover and dismiss on Escape or click", async ({
	page,
}) => {
	const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
	await expect(zoom).not.toHaveAttribute("title");
	await zoom.hover();
	await expect(page.getByRole("tooltip")).toHaveText("Zoom in+");
	await expect(zoom).toHaveAttribute("aria-describedby");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await page.getByRole("button", { name: "Shapes", exact: true }).hover();
	await expect(page.getByRole("tooltip")).toHaveText("Shapes");
	await page.getByRole("button", { name: "Shapes", exact: true }).click();
	await page.mouse.move(0, 0);
	const rectangle = page.getByRole("button", {
		name: "Rectangle",
		exact: true,
	});
	await rectangle.hover();
	await expect(page.getByRole("tooltip")).toHaveText("Rectangle");
	await rectangle.click();
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await expect(rectangle).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByRole("toolbar").locator("button[title]")).toHaveCount(
		0,
	);
});

test("keyboard focus opens tooltips without changing focus or activating a tool", async ({
	page,
}) => {
	const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
	await zoom.focus();
	await expect(page.getByRole("tooltip")).toHaveText("Zoom in+");
	await expect(zoom).toBeFocused();
	await page.keyboard.press("Tab");
	const fit = page.getByRole("button", { name: "Fit drawing", exact: true });
	await expect(fit).toBeFocused();
	await expect(page.getByRole("tooltip")).toContainText("F6");
	await expect(fit).toHaveText("100%");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await expect(fit).toBeFocused();
});

for (const width of [320, 1280]) {
	test(`tooltips stay visible above the scrolling toolbar at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 800 });
		await page
			.getByRole("button", { name: "Select locked items", exact: true })
			.hover();
		await expect(page.getByRole("tooltip")).toHaveText("Select locked items");
		const tooltip = page.locator('[data-slot="toolbar-tooltip"]');
		const box = (await tooltip.boundingBox())!;
		const toolbar = (await page
			.getByRole("toolbar", { name: "View controls", exact: true })
			.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(width);
		expect(box.y + box.height).toBeLessThan(toolbar.y);
		await page.screenshot({
			path: test.info().outputPath("toolbar-tooltip.png"),
		});
		await page.mouse.move(0, 0, { steps: 10 });
		await expect(page.getByRole("tooltip")).toHaveCount(0);
		await page
			.getByRole("button", { name: "Zoom in", exact: true })
			.scrollIntoViewIfNeeded();
		await page.getByRole("button", { name: "Zoom in", exact: true }).hover();
		await expect(page.getByRole("tooltip")).toHaveText("Zoom in+");
		await page.screenshot({
			path: test.info().outputPath("toolbar-shortcut.png"),
			clip: { x: 0, y: 600, width, height: 200 },
		});
	});
}

test("groups replace each other above the main toolbar without changing the active tool", async ({
	page,
}) => {
	const main = page.getByRole("toolbar", {
		name: "View controls",
		exact: true,
	});
	await expect(main.getByRole("button")).toHaveCount(17);
	await expect(main.getByRole("button", { name: "Export drawing", exact: true })).toBeVisible();
	const fit = main.getByRole("button", { name: "Fit drawing", exact: true });
	await main.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect(fit).toHaveText("125%");
	await main.getByRole("button", { name: "Zoom out", exact: true }).click();
	await expect(fit).toHaveText("100%");
	await main.getByRole("button", { name: "Zoom in", exact: true }).click();
	await fit.click();
	await expect(fit).toHaveText("100%");
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
		const main = page.getByRole("toolbar", {
			name: "View controls",
			exact: true,
		});
		const row = main.locator(":scope > div").first();
		const buttons = await row.getByRole("button").all();
		const top = (await buttons[0].boundingBox())!.y;
		for (const button of buttons)
			expect((await button.boundingBox())!.y).toBe(top);
		const overflow = await row.evaluate(
			(element) => element.scrollWidth > element.clientWidth,
		);
		expect(overflow).toBe(width < 400);
		if (overflow) {
			await row.evaluate((element) => {
				element.scrollLeft = element.scrollWidth;
			});
			const lastBox = (await buttons.at(-1)!.boundingBox())!;
			const rowBox = (await row.boundingBox())!;
			expect(lastBox.x).toBeGreaterThanOrEqual(rowBox.x);
			expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(
				rowBox.x + rowBox.width,
			);
		}
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
			// The secondary toolbar must remain clickable outside the scrolling row.
			await page
				.getByRole("toolbar", { name: `${label} toolbar` })
				.getByRole("button", {
					name:
						label === "Shapes"
							? "Circle"
							: label === "Connections"
								? "Wire"
								: label === "History tools"
									? "History"
									: "Export PNG",
					exact: true,
				})
				.click();
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
		await page.screenshot({
			path: test.info().outputPath("toolbar-detail.png"),
			clip: { x: 0, y: 720, width, height: 180 },
		});
	});
}

test.describe("mobile touch scrolling", () => {
	test.use({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 320, height: 844 },
	});
	test("swiping the main row reveals the last button without moving the drawing", async ({
		page,
	}) => {
		const main = page.getByRole("toolbar", {
			name: "View controls",
			exact: true,
		});
		const row = main.locator(":scope > div").first();
		const camera = await page.locator("#editor-scene").textContent();
		const box = (await row.boundingBox())!;
		const session = await page.context().newCDPSession(page);
		const startX = box.x + box.width * 0.8;
		const y = box.y + box.height / 2;
		await row.evaluate((element) => {
			element.addEventListener(
				"scrollend",
				() => element.setAttribute("data-scroll-ended", "true"),
				{ once: true },
			);
		});
		await session.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [{ x: startX, y }],
		});
		for (let step = 1; step <= 10; step++) {
			await session.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x: startX - step * 18, y }],
			});
			await page.waitForTimeout(16);
		}
		await session.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});

		await expect
			.poll(() => row.evaluate((element) => element.scrollLeft))
			.toBeGreaterThan(0);
		expect(await page.locator("#editor-scene").textContent()).toBe(camera);
		// Focus scrolling must start after touch momentum has finished.
		await expect(row).toHaveAttribute("data-scroll-ended", "true");
		await main.getByRole("button", { name: "Zoom out", exact: true }).focus();
		await expect
			.poll(() => row.evaluate((element) => element.scrollLeft))
			.toBe(0);
		await page.keyboard.press("Tab");
		await expect(
			main.getByRole("button", { name: "Zoom in", exact: true }),
		).toBeFocused();
		await session.detach();
	});
});
