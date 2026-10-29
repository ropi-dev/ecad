import { captureArtifacts } from "./artifacts";
import { expect, test, type Page } from "@playwright/test";
import { selectDrawingShape, selectSymbolItem, symbolItemPoint } from "./symbol-items";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });
const state = async (page: Page) => JSON.parse((await page.locator("#editor-document").textContent())!);
async function point(page: Page, x: number, y: number) {
 const scene = JSON.parse((await page.locator("#editor-scene").textContent())!);
 const box = (await page.locator("canvas").boundingBox())!;
 const scale = (scene.corner[0] - scene.origin[0]) / 420 * box.width / 2;
 return { x: box.x + (scene.origin[0] + 1) * box.width / 2 + x * scale, y: box.y + (1 - scene.origin[1]) * box.height / 2 - y * scale };
}
async function drag(page: Page, start: { x: number; y: number }, dx: number, dy: number) {
 await page.mouse.move(start.x, start.y); await page.mouse.down();
 await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 }); await page.mouse.up();
}
async function placeResistor(page: Page) {
 await page.goto("/tests/browser/editor.html");
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 570, y: 470 } });
 await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
}

test("symbol geometry defaults to locked while static text remains editable", async ({ page }) => {
 await page.addInitScript(() => {
  const file = { format: "ecad-symbol", version: 1, units: "mm", id: "default-locks", name: "Default locks", description: "", prefix: "U", value: "", shapes: [
   { kind: "rectangle", x: 0, y: 0, width: 30, height: 20 },
   { kind: "circle", x: 20, y: 0, radius: 4 },
   { kind: "triangle", x: -20, y: 0, width: 8, height: 8 },
   { kind: "line", x1: -10, y1: -14, x2: 10, y2: -14 },
   { kind: "pin", x: -15, y: 0, name: "Supply", number: "1" },
   { kind: "text", text: "Label", x: 0, y: 6, width: 8, height: 3, fontSize: 2 },
  ] };
  localStorage.setItem("ecad.user-config.v1", JSON.stringify({ version: 1, symbolLibraries: [{ id: "default-locks", name: "Default locks", enabled: true, source: { kind: "embedded", symbols: [file] } }] }));
 });
 await page.goto("/tests/browser/editor.html");
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Default locks", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 620, y: 450 } });
 await page.getByRole("button", { name: "Select locked items", exact: true }).click();
 for (const key of ["shape:1", "shape:2", "shape:3", "shape:4", "shape:5"]) {
  const point = await symbolItemPoint(page, key);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  if (point.kind === "pin") {
   await page.mouse.move(point.x + 4, point.y);
   await page.mouse.move(point.x, point.y);
  }
  await page.mouse.up();
  await expect(page.getByTestId("symbol-child-selection")).toHaveCount(0);
  await selectDrawingShape(page, 1);
 }
 for (const [name, value] of [["Center X", "-8"], ["Center Y", "0"]]) {
  const input = page.getByRole("spinbutton", { name, exact: true });
  await input.fill(value); await input.press("Tab");
 }
 await selectSymbolItem(page, "shape:6");
 await expect(page.getByRole("checkbox", { name: "Locked", exact: true })).not.toBeChecked();
 const content = page.getByRole("textbox", { name: "Text content", exact: true });
 await content.fill("Editable text"); await content.press("Tab");
 await expect(page.getByTestId("symbol-child-selection")).toBeVisible();
 await expect(content).toHaveValue("Editable text");
 for (let zoom = 0; zoom < 4; zoom++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
 await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
 if (captureArtifacts) await page.screenshot({ path: test.info().outputPath("default-symbol-child-locks.png") });
});

test("locked symbols ignore selection and movement until the toolbar override is on", async ({ page }) => {
 await placeResistor(page);
 await page.getByRole("button", { name: "Lock selection", exact: true }).click();
 const locked = await state(page);
 expect(locked.shapes[0].locked).toBe(true);
 await expect(page.getByRole("complementary", { name: "Selection attributes" })).toHaveCount(0);
 const symbol = locked.shapes[0];
 let center = await point(page, symbol.x, symbol.y);
 await page.mouse.click(center.x, center.y);
 await expect(page.getByRole("complementary", { name: "Selection attributes" })).toHaveCount(0);
 await drag(page, center, 60, -40);
 await page.keyboard.press("ArrowRight");
 await page.keyboard.press("r");
 await page.keyboard.press("Delete");
 await page.keyboard.down("Alt"); await drag(page, center, 60, -40); await page.keyboard.up("Alt");
 expect(await state(page)).toEqual(locked);
 const override = page.getByRole("button", { name: "Select locked items", exact: true });
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
 await expect(page.getByRole("complementary", { name: "Selection attributes" })).toHaveCount(0);
 await (await toolbarButton(page, "Undo")).click();
 expect((await state(page)).shapes).toEqual(locked.shapes);
 await expect(page.getByRole("complementary", { name: "Selection attributes" })).toHaveCount(0);
 await override.click();
 await page.mouse.click(center.x, center.y);
 await page.getByRole("button", { name: "Unlock selection", exact: true }).click();
 expect((await state(page)).shapes[0].locked).toBe(false);
 await override.click();
 await selectSymbolItem(page, "attribute:reference");
 await expect(page.getByRole("spinbutton", { name: "Anchor X", exact: true })).toBeVisible();
 await expect(page.getByRole("alert")).toHaveCount(0);
});

test("locked children stay unselectable with either toolbar flag state", async ({ page }) => {
 await placeResistor(page);
 await selectSymbolItem(page, "attribute:reference");
 await page.getByRole("button", { name: "Lock selection", exact: true }).click();
 const locked = await state(page);
 expect(locked.shapes[0].childOverrides["attribute:reference"].locked).toBe(true);
 const childSelection = page.getByTestId("symbol-child-selection");
 await expect(childSelection).toHaveCount(0);
 for (const enabled of [false, true]) {
  if (enabled) await page.getByRole("button", { name: "Select locked items", exact: true }).click();
  const label = await symbolItemPoint(page, "attribute:reference");
  await page.mouse.click(label.x, label.y);
  await expect(childSelection).toHaveCount(0);
  expect(await state(page)).toEqual(locked);
  await selectSymbolItem(page, "attribute:value");
  await expect(page.getByRole("spinbutton", { name: "Anchor X", exact: true })).toBeVisible();
  await page.locator("canvas").focus();
  await page.keyboard.press("Escape");
 }
 for (const [name, value] of [["Center X", "-10"], ["Center Y", "0"]]) {
  const input = page.getByRole("spinbutton", { name, exact: true });
  await input.fill(value); await input.press("Tab");
 }
 for (let repeat = 0; repeat < 7; repeat++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
 await expect(page.getByRole("combobox", { name: "Symbol item", exact: true })).toHaveCount(0);
 await expect(page.getByRole("combobox", { name: "Locked symbol item", exact: true })).toHaveCount(0);
 await expect(page.getByRole("button", { name: "Unlock item", exact: true })).toHaveCount(0);
 if (captureArtifacts) await page.screenshot({ path: test.info().outputPath("symbol-attributes-clean.png") });
});

test("locked standalone items are excluded from marquee and double-click selection", async ({ page }) => {
 await page.goto("/tests/browser/editor.html");
 await (await toolbarButton(page, "Text")).click();
 await page.locator("canvas").click({ position: { x: 600, y: 470 } });
 const content = page.getByRole("textbox", { name: "Text content", exact: true });
 await content.fill("Locked note"); await content.press("Tab");
 await page.getByRole("button", { name: "Lock selection", exact: true }).click();
 const before = await state(page);
 const text = before.shapes[0];
 const anchor = await point(page, text.x, text.y);
 await page.mouse.dblclick(anchor.x, anchor.y);
 await expect(content).toHaveCount(0);
 await drag(page, { x: anchor.x - 30, y: anchor.y - 30 }, 100, 100);
 await expect(page.getByRole("complementary", { name: "Selection attributes" })).toHaveCount(0);
 expect(await state(page)).toEqual(before);
 await page.getByRole("button", { name: "Select locked items", exact: true }).click();
 await drag(page, anchor, 50, -30);
 const moved = await state(page);
 expect(moved.shapes[0].locked).toBe(true);
 expect(moved.shapes[0].x).not.toBe(text.x);
 await page.getByRole("button", { name: "Select locked items", exact: true }).click();
 await page.keyboard.press("ArrowRight");
 expect(await state(page)).toEqual(moved);
});

test("unlocked children remain editable when the toolbar override selects a locked symbol", async ({ page }) => {
 await placeResistor(page);
 await page.getByRole("button", { name: "Lock selection", exact: true }).click();
 const before = await state(page);
 const symbol = before.shapes[0];
 await page.getByRole("button", { name: "Select locked items", exact: true }).click();
 const center = await point(page, symbol.x, symbol.y);
 await page.mouse.click(center.x, center.y);
 const reference = symbol.textPositions.reference;
 await drag(page, await point(page, symbol.x + reference.x, symbol.y + reference.y), 40, -30);
 const edited = await state(page);
 expect(edited.shapes[0].locked).toBe(true);
 expect(edited.shapes[0].x).toBe(symbol.x);
 expect(edited.shapes[0].y).toBe(symbol.y);
 expect(edited.shapes[0].textPositions.reference).not.toEqual(reference);
 const childSelection = page.getByTestId("symbol-child-selection");
 await expect(childSelection).toBeVisible();
 await page.keyboard.press("ArrowRight");
 const nudged = await state(page);
 expect(nudged.shapes[0].textPositions.reference.x).toBeCloseTo(edited.shapes[0].textPositions.reference.x + 1);
 expect(nudged.shapes[0].x).toBe(symbol.x);
 await page.getByRole("button", { name: "Lock selection", exact: true }).click();
 await expect(childSelection).toHaveCount(0);

 const lockedReference = (await state(page)).shapes[0].textPositions.reference;
 const label = await point(page, symbol.x + lockedReference.x, symbol.y + lockedReference.y);
 await page.mouse.click(label.x, label.y);
 await expect(childSelection).toHaveCount(0);
 await selectSymbolItem(page, "attribute:value");

});
