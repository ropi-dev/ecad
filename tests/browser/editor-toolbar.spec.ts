import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { expectKeyboardNavigation } from "./keyboard-navigation";
import { openPlacedShape } from "./symbol-items";

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
	await expect(tools).toBeVisible();
	await expectKeyboardNavigation(
		tools.getByRole("button", { disabled: false }),
		"ArrowRight",
		"ArrowLeft",
	);
	await tools.getByRole("button", { name: "Rectangle", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(page.locator('[data-tool="rectangle"]')).toBeAttached();
	// Choosing a tool closes the panel and keeps keyboard focus on its group.
	await expect(tools).toBeHidden();
	await expect(shapes).toBeFocused();
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

test("chip packagings open in a submenu from their part", async ({ page }) => {
	const symbols = page.getByRole("button", { name: "Symbols", exact: true });
	await symbols.click();
	const part = page
		.getByRole("region", { name: "Microcontrollers", exact: true })
		.getByRole("button", { name: "nRF54L15 packagings", exact: true });
	await part.click();
	const packagings = page.getByRole("dialog", {
		name: "nRF54L15 packagings",
		exact: true,
	});
	await packagings
		.getByRole("button", { name: "Insert nRF54L15-CAAA", exact: true })
		.click();
	await expect(packagings).toBeHidden();
	await expect(symbols).toHaveAttribute("aria-pressed", "true");
	await page.locator("canvas").click({ position: { x: 600, y: 300 } });
	await openPlacedShape(page);
	await expect(
		page.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveValue("nRF54L15-CAAA");
});

test("the last package is reachable on a small screen", async ({ page }) => {
	const width = 390;
	const height = 360;
	await page.setViewportSize({ width, height });
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "nRF54L15 packagings", exact: true })
		.click();
	const box = required(
		await page
			.getByRole("dialog", { name: "nRF54L15 packagings", exact: true })
			.boundingBox(),
	);
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(width);
	expect(box.y + box.height).toBeLessThanOrEqual(height);
	const last = page.getByRole("button", {
		name: "Insert nRF54L15-CAAA",
		exact: true,
	});
	await last.scrollIntoViewIfNeeded();
	await expect(last).toBeInViewport({ ratio: 1 });
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
	await openPlacedShape(page);
	await expect(
		page.getByRole("textbox", { name: "Name", exact: true }),
	).toHaveValue("Polarized capacitor");
});
