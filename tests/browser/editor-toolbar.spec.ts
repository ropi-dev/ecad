import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { expectKeyboardNavigation } from "./keyboard-navigation";

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(
		page.getByRole("button", { name: "Shapes", exact: true }),
	).toBeEnabled();
});

test("keyboard opening, tool navigation, and Escape restore focus", async ({
	page,
}) => {
	const shapes = page.getByRole("button", { name: "Shapes", exact: true });
	await shapes.focus();
	await page.keyboard.press("ArrowUp");
	const tools = page.getByRole("toolbar", {
		name: "Shapes toolbar",
		exact: true,
	});
	await expectKeyboardNavigation(
		tools.getByRole("button", { disabled: false }),
		"ArrowRight",
		"ArrowLeft",
	);
	await tools.getByRole("button", { name: "Rectangle", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(page.locator('[data-tool="rectangle"]')).toBeAttached();
	await page.keyboard.press("Escape");
	await expect(shapes).toBeFocused();
	await expect(shapes).toHaveAttribute("aria-expanded", "false");
});

test("symbol picker search, arrow keys, and Enter choose a symbol", async ({
	page,
}) => {
	const symbols = page.getByRole("button", { name: "Symbols", exact: true });
	await symbols.click();
	const search = page.getByRole("searchbox", {
		name: "Search symbols",
		exact: true,
	});
	await expect(search).toBeFocused();
	const expectHighlighted = async (name: string) =>
		expect(search).toHaveAttribute(
			"aria-activedescendant",
			required(
				await page
					.getByRole("button", { name, exact: true })
					.getAttribute("id"),
			),
		);
	await page.keyboard.press("Tab");
	await page.keyboard.type("cap");
	await expect(search).toBeFocused();
	await expect(search).toHaveValue("cap");
	await expectHighlighted("Insert Capacitor");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowUp");
	await expectHighlighted("Insert Polarized capacitor");
	await page.keyboard.press("Enter");
	await expect(symbols).toHaveAttribute("aria-pressed", "true");
	await page.locator("canvas").click({ position: { x: 600, y: 300 } });
	await expect(
		page.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveValue("Polarized capacitor");
});

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
		const box = required(await row.boundingBox());
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
