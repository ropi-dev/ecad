import { expect, test, type Page } from "@playwright/test";
import { drawingPoint, selectSymbolParent } from "./symbol-items";

test.use({ viewport: { width: 1440, height: 1000 } });
const state = async (page: Page) => JSON.parse((await page.locator("#editor-document").textContent())!);
async function resistor(page: Page, x = 600) {
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
	await page.locator("canvas").click({ position: { x, y: 450 } });
}

test("the hierarchy follows canvas selection and selects parents, children, and multiple symbols", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(page.getByText("No items in this drawing.")).toBeVisible();
	await resistor(page);
	await resistor(page, 850);
	const tree = page.getByRole("tree", { name: "Drawing items" });
	const first = tree.getByRole("treeitem", { name: "R1 · Resistor", exact: true });
	const second = tree.getByRole("treeitem", { name: "R2 · Resistor", exact: true });
	await expect(first).toHaveAttribute("aria-selected", "false");
	await expect(second).toHaveAttribute("aria-selected", "true");
	await first.click();
	await expect(first).toHaveAttribute("aria-selected", "true");
	await expect(page.getByRole("textbox", { name: "Reference", exact: true })).toHaveValue("R1");
	const reference = tree.getByRole("treeitem", { name: "reference · R1", exact: true });
	await reference.click();
	await expect(reference).toHaveAttribute("aria-selected", "true");
	await expect(first).toHaveAttribute("aria-selected", "false");
	const before = await state(page);
	const anchor = page.getByRole("spinbutton", { name: "Anchor X", exact: true });
	await anchor.fill("-5"); await anchor.press("Tab");
	expect((await state(page)).shapes[0].x).toBe(before.shapes[0].x);
	expect((await state(page)).shapes[0].textPositions.reference.x).toBe(-5);
	await selectSymbolParent(page);
	await expect(first).toHaveAttribute("aria-selected", "true");
	const symbol = (await state(page)).shapes[0];
	const label = await drawingPoint(page, { x: symbol.x - 5, y: symbol.y + symbol.textPositions.reference.y });
	await page.mouse.move(label.x, label.y); await page.mouse.down();
	await page.mouse.move(label.x + 15, label.y - 15); await page.mouse.up();
	await expect(reference).toHaveAttribute("aria-selected", "true");
	await first.click();
	await second.click({ modifiers: ["Control"] });
	await expect(first).toHaveAttribute("aria-selected", "true");
	await expect(second).toHaveAttribute("aria-selected", "true");
	await page.locator("canvas").click({ position: { x: 1000, y: 730 } });
	await expect(tree.getByRole("treeitem", { selected: true })).toHaveCount(0);
	for (const [item, x] of [[first, "-10"], [second, "15"]] as const) {
		await item.click();
		for (const [name, value] of [["Center X", x], ["Center Y", "0"]]) {
			const input = page.getByRole("spinbutton", { name, exact: true });
			await input.fill(value); await input.press("Tab");
		}
	}
	await reference.click();
	for (const [name, value] of [["Anchor X", "-4"], ["Anchor Y", "4"]]) {
		const input = page.getByRole("spinbutton", { name, exact: true });
		await input.fill(value); await input.press("Tab");
	}
	for (let zoom = 0; zoom < 5; zoom++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	await page.screenshot({ path: test.info().outputPath("item-hierarchy-selection.png") });
});

test("tree selection respects root overrides and permanent child locks", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await resistor(page);
	const tree = page.getByRole("tree", { name: "Drawing items" });
	const parent = tree.getByRole("treeitem", { name: "R1 · Resistor", exact: true });
	const child = tree.getByRole("treeitem", { name: "reference · R1", exact: true });
	await child.click();
	await page.getByRole("button", { name: "Lock selection", exact: true }).click();
	await expect(child).toHaveAttribute("aria-disabled", "true");
	await page.getByRole("button", { name: "Lock selection", exact: true }).click();
	await expect(parent).toHaveAttribute("aria-disabled", "true");
	const before = await state(page);
	await parent.click({ force: true });
	await expect(tree.getByRole("treeitem", { selected: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Select locked items", exact: true }).click();
	await expect(parent).toHaveAttribute("aria-disabled", "false");
	await parent.click();
	await expect(parent).toHaveAttribute("aria-selected", "true");
	await child.click({ force: true });
	await expect(child).toHaveAttribute("aria-selected", "false");
	await expect(child).toHaveAttribute("aria-disabled", "true");
	await expect(parent).toHaveAttribute("aria-selected", "true");
	const value = tree.getByRole("treeitem", { name: "value · 10 kΩ", exact: true });
	await expect(value).toHaveAttribute("aria-disabled", "false");
	await value.click();
	await expect(value).toHaveAttribute("aria-selected", "true");
	expect(await state(page)).toEqual(before);
	await page.getByRole("button", { name: "Select locked items", exact: true }).click();
	await expect(tree.getByRole("treeitem", { selected: true })).toHaveCount(0);
});

test("the tree supports expansion, keyboard selection, and long drawings without mounting every row", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await resistor(page);
	const tree = page.getByRole("tree", { name: "Drawing items" });
	await page.getByRole("button", { name: "Collapse R1 · Resistor", exact: true }).click();
	await expect(tree.getByRole("treeitem")).toHaveCount(1);
	await tree.focus();
	await page.keyboard.press("ArrowRight");
	await expect(tree.getByRole("treeitem")).toHaveCount(8);
	await page.keyboard.press("End"); await page.keyboard.press("Enter");
	await expect(tree.getByRole("treeitem", { name: "value · 10 kΩ", exact: true })).toHaveAttribute("aria-selected", "true");
	await page.evaluate(async () => {
		const editorPath = "/tests/browser/editor.tsx";
		const storePath = "/packages/core/src/commands/drawing-store.ts";
		const { drawingStore } = await import(editorPath);
		const { createDrawingStore } = await import(storePath);
		const shapes = Array.from({ length: 2000 }, (_, index) => ({ id: index + 1, kind: "rectangle", x: (index % 100) * 4, y: Math.floor(index / 100) * 4, width: 2, height: 2, lineWidth: 0.2, rotation: 0 }));
		const fixture = createDrawingStore(shapes);
		drawingStore.transact(() => [undefined, fixture.getSnapshot()]);
	});
	await expect.poll(() => tree.getByRole("treeitem").count()).toBeLessThan(50);
	await tree.focus();
	await page.keyboard.press("End"); await page.keyboard.press("Enter");
	const last = tree.getByRole("treeitem", { name: "Rectangle 2000", exact: true });
	await expect(last).toBeVisible();
	await expect(last).toHaveAttribute("aria-selected", "true");
	await expect.poll(() => tree.getByRole("treeitem").count()).toBeLessThan(50);
	await page.keyboard.press("Home"); await page.keyboard.press("Enter");
	await expect(tree.getByRole("treeitem", { name: "Rectangle 1", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("the hierarchy can be shown and hidden on a narrow viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/tests/browser/editor.html");
	const toggle = page.getByRole("button", { name: "Item hierarchy", exact: true });
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await toggle.click();
	const panel = page.getByRole("complementary", { name: "Item hierarchy", exact: true });
	await expect(panel).toBeVisible();
	const box = (await panel.boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(390);
	await page.screenshot({ path: test.info().outputPath("item-hierarchy-mobile.png") });
	await page.getByRole("button", { name: "Hide item hierarchy", exact: true }).click();
	await expect(toggle).toBeVisible();
	await expect(toggle).toBeFocused();
});
