import { expect, test, type Page } from "@playwright/test";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });
const state = async (page: Page) => JSON.parse((await page.locator("#editor-document").textContent())!);
const scene = async (page: Page) => JSON.parse((await page.locator("#editor-scene").textContent())!);

async function expectAnchor(page: Page, id: string, point: { x: number; y: number }) {
 const marker = page.locator(`[data-testid="text-anchor"][data-anchor-id="${id}"]`);
 await expect(marker).toBeVisible();
 await expect.poll(async () => {
 const data = await scene(page);
 const canvas = (await page.locator("canvas").boundingBox())!;
 const expectedX = canvas.x + (1 + data.origin[0] + (data.corner[0] - data.origin[0]) * point.x / 420) * canvas.width / 2;
 const expectedY = canvas.y + (1 - data.origin[1] - (data.corner[1] - data.origin[1]) * point.y / 297) * canvas.height / 2;
 const bounds = (await marker.boundingBox())!;
 return Math.max(Math.abs(bounds.x + bounds.width / 2 - expectedX), Math.abs(bounds.y + bounds.height / 2 - expectedY));
 }).toBeLessThan(1);
 await expect(marker).toHaveCSS("width", "9px");
 await expect(marker).toHaveCSS("height", "9px");
 await expect(marker).toHaveCSS("z-index", "1");
 await expect(marker).toHaveCSS("pointer-events", "none");
}

test("text alignment moves rendered bounds, updates multiline textures and supports undo", async ({ page }) => {
 await page.goto("/tests/browser/editor.html");
 await (await toolbarButton(page, "Text")).click();
 await page.locator("canvas").click({ position: { x: 600, y: 430 } });
 const content = page.getByRole("textbox", { name: "Text content", exact: true });
 await content.fill("Supply voltage\n3.3 V");
 await content.press("Tab");
 const h = page.getByRole("combobox", { name: "Text horizontal alignment", exact: true });
 const v = page.getByRole("combobox", { name: "Text vertical alignment", exact: true });
 const before = await state(page);
 await h.selectOption("left");
 await v.selectOption("top");
 await expectAnchor(page, "1", before.shapes[0]);
 const aligned = (await state(page)).shapes[0];
 expect(aligned).toMatchObject({ x: before.shapes[0].x, y: before.shapes[0].y, horizontalAlign: "left", verticalAlign: "top" });
 await expect.poll(async () => (await scene(page)).shapes[0]?.x).toBeCloseTo(aligned.x + aligned.width / 2);
 await expect.poll(async () => (await scene(page)).shapes[0]?.y).toBeCloseTo(aligned.y - aligned.height / 2);
 const texture = (await scene(page)).shapes[0].texture;
 await h.selectOption("right");
 await expect.poll(async () => (await scene(page)).shapes[0]?.texture).not.toBe(texture);
 await (await toolbarButton(page, "Undo")).click();
 await expect(h).toHaveValue("left");
 await (await toolbarButton(page, "Redo")).click();
 await expect(h).toHaveValue("right");
 const angle = page.getByRole("spinbutton", { name: "Angle", exact: true });
 await angle.fill("90"); await angle.press("Tab");
 await expect.poll(async () => (await scene(page)).shapes[0]?.x).toBeCloseTo(aligned.x + aligned.height / 2);
 await expect.poll(async () => (await scene(page)).shapes[0]?.y).toBeCloseTo(aligned.y - aligned.width / 2);
 await expectAnchor(page, "1", aligned);
 await angle.fill("0"); await angle.press("Tab");
 await h.selectOption("left");
 for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
 await expectAnchor(page, "1", aligned);
 await page.screenshot({ path: test.info().outputPath("text-alignment.png") });
 await page.getByRole("button", { name: "Clear selection", exact: true }).click();
 await expect(page.getByTestId("text-anchor")).toHaveCount(0);
 await expect(page.getByRole("alert")).toHaveCount(0);
});

test("symbol labels keep alignment per instance through rotation, dragging and undo", async ({ page }) => {
 await page.goto("/tests/browser/editor.html");
 for (const x of [450, 800]) {
  await page.getByRole("button", { name: "Symbols", exact: true }).click();
  await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
  await page.locator("canvas").click({ position: { x, y: 450 } });
 }
 const initial = await state(page);
 const horizontal = page.getByRole("combobox", { name: "Reference text horizontal alignment", exact: true });
 const vertical = page.getByRole("combobox", { name: "Reference text vertical alignment", exact: true });
 await horizontal.selectOption("right");
 await vertical.selectOption("bottom");
 let shapes = (await state(page)).shapes;
 expect(shapes[0]).toEqual(initial.shapes[0]);
 expect(shapes[1]).toMatchObject({ x: initial.shapes[1].x, y: initial.shapes[1].y, textAlignments: { reference: { horizontalAlign: "right", verticalAlign: "bottom" } } });
 const angle = page.getByRole("spinbutton", { name: "Angle", exact: true });
 await angle.fill("90"); await angle.press("Tab");
 await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
 await expect.poll(async () => (await scene(page)).shapes[1]?.rotation).toBeCloseTo(Math.PI / 2);
 await expect(page.getByTestId("text-anchor")).toHaveCount(2);
 const selectedSymbol = (await state(page)).shapes[1];
 const labelAnchor = selectedSymbol.textPositions.reference;
 await expectAnchor(page, "2:label:0", { x: selectedSymbol.x - labelAnchor.y, y: selectedSymbol.y + labelAnchor.x });
 const data = await scene(page);
 const label = data.symbolTexts.find((label: {name: string}) => label.name === "reference 2");
 const box = (await page.locator("canvas").boundingBox())!;
 const scale = (data.corner[0] - data.origin[0]) / 420 * box.width / 2;
 const x = box.x + (data.origin[0] + 1) * box.width / 2 + label.x * scale;
 const y = box.y + (1 - data.origin[1]) * box.height / 2 - label.y * scale;
 await page.mouse.move(x, y); await page.mouse.down();
 await page.mouse.move(x + 40, y - 30, { steps: 5 }); await page.mouse.up();
 shapes = (await state(page)).shapes;
 expect(shapes[1].textPositions.reference).not.toEqual(initial.shapes[1].textPositions.reference);
 expect(shapes[1].textAlignments.reference).toEqual({ horizontalAlign: "right", verticalAlign: "bottom" });
 expect(shapes[1].x).toBe(initial.shapes[1].x);
 await (await toolbarButton(page, "Undo")).click();
 expect((await state(page)).shapes[1].textPositions).toEqual(initial.shapes[1].textPositions);
 await angle.fill("0"); await angle.press("Tab");
 for (const [axis, value] of [["X", "-8"], ["Y", "0"]]) {
 const input = page.getByRole("spinbutton", { name: `Center ${axis}`, exact: true });
 await input.fill(value); await input.press("Tab");
 }
 for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
 await vertical.scrollIntoViewIfNeeded();
 await page.screenshot({ path: test.info().outputPath("symbol-label-alignment.png") });
 await page.getByRole("button", { name: "Clear selection", exact: true }).click();
 await expect(page.getByTestId("text-anchor")).toHaveCount(0);
 await expect(page.getByRole("alert")).toHaveCount(0);
});

test("aligned text in a user symbol saves and renders in placed instances", async ({ page }) => {
 const file = { format: "ecad-symbol", version: 1, units: "mm", id: "aligned-part", name: "Aligned part", description: "", prefix: "U", value: "", shapes: [
  { kind: "rectangle", x: 0, y: 0, width: 30, height: 20 },
  { kind: "text", text: "POWER\n3.3 V", x: 0, y: 0, width: 12, height: 6, fontSize: 2, rotation: 45, horizontalAlign: "left", verticalAlign: "top" },
 ] };
 await page.goto("/tests/browser/editor.html");
 await page.evaluate(file => localStorage.setItem("ecad.user-config.v1", JSON.stringify({ version: 1, symbolLibraries: [{ id: "alignment", name: "Alignment", enabled: true, source: { kind: "embedded", symbols: [file] } }] })), file);
 await page.reload();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Aligned part", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 600, y: 450 } });
 await expect.poll(async () => (await scene(page)).symbolStaticTexts.find((text: {name: string}) => text.name === "text 1:2")?.name).toBe("text 1:2");
 await expect(page.getByTestId("text-anchor")).toHaveCount(1);
 await expectAnchor(page, "1:text:2", (await state(page)).shapes[0]);
 await page.getByRole("button", { name: "Edit symbol", exact: true }).click();
 await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Aligned part");
 await (await toolbarButton(page, "Text")).click();
 await page.locator("canvas").click({ position: { x: 600, y: 450 } });
 const content = page.getByRole("textbox", { name: "Text content", exact: true });
 await content.fill("OUTPUT"); await content.press("Tab");
 await page.getByRole("combobox", { name: "Text horizontal alignment", exact: true }).selectOption("right");
 await page.getByRole("combobox", { name: "Text vertical alignment", exact: true }).selectOption("bottom");
 await expect(page.getByRole("status")).toHaveText("Saved");
 const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ecad.user-config.v1")!).symbolLibraries[0].source.symbols[0]);
 expect(saved.shapes[2]).toMatchObject({ kind: "text", text: "OUTPUT", horizontalAlign: "right", verticalAlign: "bottom" });
 for (const [name, value] of [["Font size", "2"], ["Anchor X", "-4"], ["Anchor Y", "-3"]]) {
 const input = page.getByRole("spinbutton", { name, exact: true });
 await input.fill(value); await input.press("Tab");
 }
 for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom out", exact: true }).click();
 await expect(page.getByRole("status")).toHaveText("Saved");
 await expectAnchor(page, "3", { x: -4, y: -3 });
 await page.screenshot({ path: test.info().outputPath("symbol-definition-text-alignment.png") });
 await page.getByRole("button", { name: "Back to schematic", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Aligned part", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 400, y: 450 } });
 await expect.poll(async () => (await state(page)).shapes[1]?.children.length).toBe(3);
 await expect.poll(async () => (await scene(page)).symbolStaticTexts.filter((text: {name: string}) => text.name.startsWith("text 2:")).length).toBe(2);
 const angle = page.getByRole("spinbutton", { name: "Angle", exact: true });
 await angle.fill("90"); await angle.press("Tab");
 await expect.poll(async () => (await scene(page)).symbolStaticTexts.find((text: {name: string}) => text.name === "text 2:2")?.rotation).toBeCloseTo(3 * Math.PI / 4);
 await expect(page.getByTestId("text-anchor")).toHaveCount(2);
 const instance = (await state(page)).shapes[1];
 await expectAnchor(page, "2:text:3", { x: instance.x + 3, y: instance.y - 4 });
 await expect(page.getByRole("alert")).toHaveCount(0);
});

test("text glyphs are vertically centered around the middle alignment anchor", async ({ page }) => {
 await page.goto("/tests/browser/editor.html");
 const centers = await page.evaluate(async () => {
  const textModule = "/packages/core/src/engine/drawing/text.ts";
  const { createTextMaterial } = await import(textModule);
  return ["R7", "10 kΩ", "abc", "gyp", "Ág", "Supply voltage\n3.3 V"].map(text => {
   const resource = createTextMaterial(text, "center");
   try {
    const canvas = resource.material.map!.image as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let top = canvas.height, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
     if (pixels[(y * canvas.width + x) * 4 + 3] > 32) {
      top = Math.min(top, y); bottom = Math.max(bottom, y);
     }
    }
    return { text, offset: (top + bottom + 1 - canvas.height) / 2 };
   } finally { resource.dispose(); }
  });
 });
 for (const { text, offset } of centers) expect(Math.abs(offset), `${text} glyph center`).toBeLessThanOrEqual(1);
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 600, y: 450 } });
 const reference = page.getByRole("textbox", { name: "Reference", exact: true });
 await reference.fill("R7"); await reference.press("Tab");
 for (const [name, value] of [["Value text Y", "0"], ["Center X", "-5"], ["Center Y", "0"]]) {
  const input = page.getByRole("spinbutton", { name, exact: true });
  await input.fill(value); await input.press("Tab");
 }
 for (let i = 0; i < 10; i++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
 await expectAnchor(page, "1:label:1", { x: -5, y: 0 });
 await page.getByRole("combobox", { name: "Value text vertical alignment", exact: true }).scrollIntoViewIfNeeded();
 await page.screenshot({ path: test.info().outputPath("text-middle-alignment.png") });
});
