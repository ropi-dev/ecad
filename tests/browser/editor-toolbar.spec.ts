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
		"ArrowDown",
		"ArrowUp",
	);
	await tools.getByRole("button", { name: "Rectangle", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(page.locator('[data-tool="rectangle"]')).toBeAttached();
	// Choosing a tool closes the panel and keeps keyboard focus on its group.
	await expect(tools).toBeHidden();
	await expect(shapes).toBeFocused();
	// Focus returns quietly: no tooltip pops up over the canvas, including
	// after the 350 ms tooltip delay.
	await page.waitForTimeout(500);
	await expect(page.locator('[data-slot="toolbar-tooltip"]')).toHaveCount(0);
	await expect(shapes).toHaveAttribute("data-active", "true");
	await page.keyboard.press("ArrowUp");
	await expect(
		tools.getByRole("button", { name: "Rectangle", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(shapes).toBeFocused();
	await expect(shapes).toHaveAttribute("aria-expanded", "false");
	// Tabbing out of an open panel closes it.
	await page.keyboard.press("ArrowUp");
	await expect(tools).toBeVisible();
	await page.keyboard.press("Shift+Tab");
	await expect(tools).toBeHidden();
	await shapes.focus();
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("End");
	await expect(
		tools.getByRole("button", { name: "Text", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(tools).toBeHidden();
});

test("clicking a submenu's padding keeps it open", async ({ page }) => {
	await page.getByRole("button", { name: "Shapes", exact: true }).click();
	const tools = page.getByRole("toolbar", {
		name: "Shapes toolbar",
		exact: true,
	});
	await expect(tools).toBeVisible();
	await tools.click({ position: { x: 2, y: 2 } });
	await expect(tools).toBeFocused();
	await expect(tools).toBeVisible();
});

test("chip packagings open in a submenu from their part", async ({ page }) => {
	const symbols = page.getByRole("button", { name: "Symbols", exact: true });
	await symbols.click();
	const part = page
		.getByRole("region", { name: "Microcontrollers", exact: true })
		.getByRole("button", { name: "nRF54L15 packagings", exact: true });
	await expect(part).toHaveAttribute("aria-expanded", "false");
	await expect(part).toContainText("nRF54L154 packagings");
	await expect(
		page.getByRole("button", { name: /^Insert nRF54L15-/ }),
	).toHaveCount(0);
	await part.click();
	const packagings = page.getByRole("dialog", {
		name: "nRF54L15 packagings",
		exact: true,
	});
	await expect(part).toHaveAttribute("aria-expanded", "true");
	expect(
		await packagings
			.getByRole("button")
			.evaluateAll((buttons) =>
				buttons.map((button) => button.getAttribute("aria-label")),
			),
	).toEqual([
		"Insert nRF54L15-QDAA",
		"Insert nRF54L15-QFAA",
		"Insert nRF54L15-QGAA",
		"Insert nRF54L15-CAAA",
	]);
	await expect(
		packagings.getByRole("button", {
			name: "Insert nRF54L15-CAAA",
			exact: true,
		}),
	).toContainText("CAAA47-ball wafer-level CSP");
	await packagings
		.getByRole("button", { name: "Insert nRF54L15-CAAA", exact: true })
		.click();
	await expect(packagings).toBeHidden();
	await expect(symbols).toHaveAttribute("aria-pressed", "true");
	await page.locator("canvas").click({ position: { x: 600, y: 300 } });
	await expect(
		page.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveValue("nRF54L15-CAAA");
});

test("arrow keys, Enter, and Escape navigate packaging submenus", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	const search = page.getByRole("searchbox", {
		name: "Search symbols",
		exact: true,
	});
	const expectHighlighted = async (name: string) =>
		expect(search).toHaveAttribute(
			"aria-activedescendant",
			required(
				await page
					.getByRole("button", { name, exact: true })
					.getAttribute("id"),
			),
		);
	await search.fill("nRF54L");
	await expectHighlighted("nRF54L15 packagings");
	await page.keyboard.press("ArrowDown");
	await expectHighlighted("nRF54L10 packagings");
	await page.keyboard.press("ArrowRight");
	const packagings = page.getByRole("dialog", {
		name: "nRF54L10 packagings",
		exact: true,
	});
	await expect(packagings.getByRole("button")).toHaveCount(3);
	await expectHighlighted("Insert nRF54L10-QDAA");
	await expect(search).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await expectHighlighted("Insert nRF54L10-QGAA");
	await page.keyboard.press("ArrowLeft");
	await expect(packagings).toBeHidden();
	await expectHighlighted("nRF54L10 packagings");
	await page.keyboard.press("Enter");
	await expect(packagings).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(packagings).toBeHidden();
	await expect(search).toBeFocused();
	await expect(search).toHaveValue("nRF54L");
	await page.keyboard.press("Enter");
	await page.keyboard.press("ArrowDown");
	await expectHighlighted("Insert nRF54L10-QFAA");
	await page.keyboard.press("Enter");
	await expect(search).toBeHidden();
	await page.locator("canvas").click({ position: { x: 600, y: 300 } });
	await expect(
		page.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveValue("nRF54L10-QFAA");
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
	await page.keyboard.press("Tab");
	await expect(
		page.getByRole("button", { name: "Insert Capacitor", exact: true }),
	).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(search).toBeFocused();
	await expectHighlighted("Insert Resistor, US");
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
			name: "Schematic tools",
			exact: true,
		});
		const row = main.locator(":scope > div").first();
		// The scene summary also counts GPU textures, which change as lazy
		// resources load; only the camera shows whether the drawing moved.
		const cameraState = async () => {
			const { camera, direction, origin, corner } = JSON.parse(
				required(await page.locator("#editor-scene").textContent()),
			);
			return { camera, direction, origin, corner };
		};
		const camera = await cameraState();
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
		expect(await cameraState()).toEqual(camera);
		// Focus scrolling must start after touch momentum has finished.
		await expect(row).toHaveAttribute("data-scroll-ended", "true");
		await main.getByRole("button", { name: "History", exact: true }).focus();
		await expect
			.poll(() => row.evaluate((element) => element.scrollLeft))
			.toBe(0);
		await page.keyboard.press("Tab");
		await expect(
			main.getByRole("button", { name: "Select", exact: true }),
		).toBeFocused();
		await session.detach();
	});
});
