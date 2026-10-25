import { expect, test, type Page } from "@playwright/test";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });
const state = async (page: Page) => JSON.parse((await page.locator("#editor-document").textContent())!);
async function resistor(page: Page, x = 600) {
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
	await page.locator("canvas").click({ position: { x, y: 450 } });
}

test("symbols expose their lock state as an editable attribute with undo and redo", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await resistor(page);
	for (const [name, value] of [["Center X", "-8"], ["Center Y", "0"]]) {
		const input = page.getByRole("spinbutton", { name, exact: true });
		await input.fill(value); await input.press("Tab");
	}
	const locked = page.getByRole("checkbox", { name: "Locked", exact: true });
	await expect(locked).not.toBeChecked();
	await locked.click();
	expect((await state(page)).shapes[0].locked).toBe(true);
	await expect(locked).toHaveCount(0);
	await page.getByRole("button", { name: "Select locked items", exact: true }).click();
	await page.getByRole("treeitem", { name: "R1 · Resistor", exact: true }).click();
	await expect(locked).toBeChecked();
	await locked.uncheck();
	expect((await state(page)).shapes[0].locked).toBe(false);
	await (await toolbarButton(page, "Undo")).click();
	await expect(locked).toBeChecked();
	await (await toolbarButton(page, "Redo")).click();
	await expect(locked).not.toBeChecked();
	await locked.click();
	for (let zoom = 0; zoom < 5; zoom++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	await page.screenshot({ path: test.info().outputPath("locked-attribute.png") });
});

test("the Locked attribute on symbol children changes only the selected child", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await resistor(page);
	const reference = page.getByRole("treeitem", { name: "reference · R1", exact: true });
	await reference.click();
	await page.getByRole("checkbox", { name: "Locked", exact: true }).click();
	const symbol = (await state(page)).shapes[0];
	expect(symbol.locked).not.toBe(true);
	expect(symbol.childOverrides["attribute:reference"].locked).toBe(true);
	await expect(reference).toHaveAttribute("aria-disabled", "true");
	await expect(page.getByRole("checkbox", { name: "Locked", exact: true })).not.toBeChecked();
	await page.getByRole("button", { name: "Select locked items", exact: true }).click();
	await expect(reference).toHaveAttribute("aria-disabled", "true");
	await (await toolbarButton(page, "Undo")).click();
	await expect(reference).toHaveAttribute("aria-disabled", "false");
	await expect(page.getByRole("treeitem", { name: "Rectangle 2", exact: true })).toHaveAttribute("aria-disabled", "true");
});

test("standalone items can be locked and unlocked through Attributes", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(550, 450); await page.mouse.down();
	await page.mouse.move(650, 500); await page.mouse.up();
	await page.getByRole("checkbox", { name: "Locked", exact: true }).click();
	expect((await state(page)).shapes[0].locked).toBe(true);
	await page.getByRole("button", { name: "Select locked items", exact: true }).click();
	await page.getByRole("treeitem", { name: "Rectangle 1", exact: true }).click();
	const locked = page.getByRole("checkbox", { name: "Locked", exact: true });
	await expect(locked).toBeChecked();
	await locked.uncheck();
	expect((await state(page)).shapes[0].locked).toBe(false);
});

test("mixed lock attributes apply to every selected symbol", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await resistor(page);
	await page.getByRole("button", { name: "Select locked items", exact: true }).click();
	await page.getByRole("checkbox", { name: "Locked", exact: true }).click();
	await resistor(page, 850);
	await page.getByRole("treeitem", { name: "R1 · Resistor", exact: true }).click({ modifiers: ["Control"] });
	const locked = page.getByRole("checkbox", { name: "Locked", exact: true });
	await expect(locked).toHaveJSProperty("indeterminate", true);
	await locked.click();
	expect((await state(page)).shapes.every((shape: { locked?: boolean }) => shape.locked)).toBe(true);
	await expect(locked).toBeChecked();
	await expect(locked).toHaveJSProperty("indeterminate", false);
	await locked.uncheck();
	expect((await state(page)).shapes.every((shape: { locked?: boolean }) => shape.locked === false)).toBe(true);
	await (await toolbarButton(page, "Undo")).click();
	await expect(locked).toBeChecked();
});
