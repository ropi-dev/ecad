import { expect, test, type Page } from "@playwright/test";
import { selectSymbolItem } from "./symbol-items";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });
const state = async (page: Page) =>
	JSON.parse((await page.locator("#editor-document").textContent())!);
async function point(page: Page, x: number, y: number) {
	const scene = JSON.parse(
		(await page.locator("#editor-scene").textContent())!,
	);
	const box = (await page.locator("canvas").boundingBox())!;
	const scale = (((scene.corner[0] - scene.origin[0]) / 420) * box.width) / 2;
	return {
		x: box.x + ((scene.origin[0] + 1) * box.width) / 2 + x * scale,
		y: box.y + ((1 - scene.origin[1]) * box.height) / 2 - y * scale,
	};
}
async function drag(
	page: Page,
	start: { x: number; y: number },
	dx: number,
	dy: number,
) {
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 });
	await page.mouse.up();
}
async function placeResistor(page: Page) {
	await page.goto("/tests/browser/editor.html");
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	await page.locator("canvas").click({ position: { x: 570, y: 470 } });
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
}

test("locked symbols ignore selection and movement until the toolbar override is on", async ({
	page,
}) => {
	await placeResistor(page);
	await page
		.getByRole("button", { name: "Lock selection", exact: true })
		.click();
	const locked = await state(page);
	expect(locked.shapes[0].locked).toBe(true);
	await expect(
		page.getByRole("complementary", { name: "Selection attributes" }),
	).toHaveCount(0);
	const symbol = locked.shapes[0];
	let center = await point(page, symbol.x, symbol.y);
	await page.mouse.click(center.x, center.y);
	await expect(
		page.getByRole("complementary", { name: "Selection attributes" }),
	).toHaveCount(0);
	await drag(page, center, 60, -40);
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("r");
	await page.keyboard.press("Delete");
	await page.keyboard.down("Alt");
	await drag(page, center, 60, -40);
	await page.keyboard.up("Alt");
	expect(await state(page)).toEqual(locked);
	const override = page.getByRole("button", {
		name: "Select locked items",
		exact: true,
	});
	await override.click();
	await expect(override).toHaveAttribute("aria-pressed", "true");
	const unchangedHistory = await state(page);
	center = await point(page, symbol.x, symbol.y);
	await page.mouse.click(center.x, center.y);
	const childSelection = page.getByTestId("symbol-child-selection");
	await expect(childSelection).toHaveCount(0);
	await drag(page, center, 70, -35);
	const moved = await state(page);
	expect(moved.shapes[0].x).not.toBe(symbol.x);
	expect(moved.shapes[0].textPositions).toEqual(symbol.textPositions);
	expect(moved.historySize).toBe(unchangedHistory.historySize + 1);
	await expect(childSelection).toHaveCount(0);
	await override.click();
	await expect(
		page.getByRole("complementary", { name: "Selection attributes" }),
	).toHaveCount(0);
	await (await toolbarButton(page, "Undo")).click();
	expect((await state(page)).shapes).toEqual(locked.shapes);
	await expect(
		page.getByRole("complementary", { name: "Selection attributes" }),
	).toHaveCount(0);
	await override.click();
	await page.mouse.click(center.x, center.y);
	await page
		.getByRole("button", { name: "Unlock selection", exact: true })
		.click();
	expect((await state(page)).shapes[0].locked).toBe(false);
	await override.click();
	await selectSymbolItem(page, "attribute:reference");
	await expect(
		page.getByRole("spinbutton", { name: "Anchor X", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("alert")).toHaveCount(0);
});
