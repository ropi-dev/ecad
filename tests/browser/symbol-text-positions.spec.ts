import { expect, test, type Page } from "@playwright/test";
import type { EditorSymbol } from "#/drawing/shapes.ts";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 1000 } });
const state = async (page: Page) => JSON.parse((await page.locator("#editor-document").textContent())!) as { shapes: EditorSymbol[]; historySize: number };

async function labelScreen(page: Page, symbolId: number, attribute = "reference") {
 const scene = JSON.parse((await page.locator("#editor-scene").textContent())!);
 const text = scene.symbolTexts.find((text: { name: string }) => text.name === `${attribute} ${symbolId}`);
 const box = (await page.locator("canvas").boundingBox())!;
 const scale = (scene.corner[0] - scene.origin[0]) / 420 * box.width / 2;
 return { x: box.x + (scene.origin[0] + 1) * box.width / 2 + text.x * scale,
  y: box.y + (1 - scene.origin[1]) * box.height / 2 - text.y * scale };
}

test("dragging symbol labels edits only that instance, supports cancel and undo, and follows rotation", async ({ page }) => {
 await page.goto("/tests/browser/editor.html");
 for (const x of [0.4, 0.65]) {
  await page.getByRole("button", { name: "Symbols", exact: true }).click();
  await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
  const box = (await page.locator("canvas").boundingBox())!;
  await page.locator("canvas").click({ position: { x: box.width * x, y: box.height * 0.5 } });
 }
 await (await toolbarButton(page, "Snap to grid")).click();
 const before = await state(page);
 const start = await labelScreen(page, 1);
 await page.mouse.move(start.x, start.y);
 await page.mouse.down();
 await page.mouse.move(start.x + 70, start.y - 55, { steps: 8 });
 // Draft movement does not create history until release.
 expect(await state(page)).toEqual(before);
 await page.mouse.up();
 const moved = await state(page);
 expect(moved.historySize).toBe(before.historySize + 1);
 expect(moved.shapes[1]).toEqual(before.shapes[1]);
 const { textPositions: beforePositions, ...beforeBody } = before.shapes[0];
 const { textPositions: afterPositions, ...afterBody } = moved.shapes[0];
 expect(afterBody).toEqual(beforeBody);
 expect(afterPositions!.reference).not.toEqual(beforePositions!.reference);
 expect(afterPositions!.value).toEqual(beforePositions!.value);
 await expect.poll(async () => (await labelScreen(page, 1)).x).toBeCloseTo(start.x + 70, 2);
 await expect.poll(async () => (await labelScreen(page, 1)).y).toBeCloseTo(start.y - 55, 2);
 await (await toolbarButton(page, "Undo")).click();
 expect((await state(page)).shapes).toEqual(before.shapes);
 await (await toolbarButton(page, "Redo")).click();
 expect((await state(page)).shapes).toEqual(moved.shapes);
 const cancel = await labelScreen(page, 1);
 await page.mouse.move(cancel.x, cancel.y);
 await page.mouse.down();
 await page.mouse.move(cancel.x + 30, cancel.y + 30, { steps: 4 });
 await page.keyboard.press("Escape");
 await page.mouse.up();
 expect(await state(page)).toEqual(moved);
 const angle = page.getByRole("spinbutton", { name: "Angle", exact: true });
 await angle.fill("90"); await angle.press("Tab");
 await expect.poll(async () => JSON.parse((await page.locator("#editor-scene").textContent())!).shapes.find((shape: { name: string }) => shape.name === "symbol 1")?.rotation).toBeCloseTo(Math.PI / 2);
 const rotated = await labelScreen(page, 1);
 await page.mouse.move(rotated.x, rotated.y);
 await page.mouse.down();
 await page.mouse.move(rotated.x - 45, rotated.y + 35, { steps: 5 });
 await page.mouse.up();
 await expect.poll(async () => (await labelScreen(page, 1)).x).toBeCloseTo(rotated.x - 45, 2);
 await expect.poll(async () => (await labelScreen(page, 1)).y).toBeCloseTo(rotated.y + 35, 2);
 const xInput = page.getByRole("spinbutton", { name: "Reference text X", exact: true });
 const committedX = await xInput.getAttribute("data-committed-value");
 await xInput.fill("12");
 await expect(xInput).toHaveAttribute("data-committed-value", committedX!);
 await xInput.press("Tab");
 await expect(xInput).toHaveAttribute("data-committed-value", "12");
 expect((await state(page)).shapes[0].textPositions!.reference!.x).toBe(12);
 await expect(page.getByRole("alert")).toHaveCount(0);
 // Arrange a close view of the edited and untouched instances for visual review.
 for (const [name, value] of [["Angle", "0"], ["Reference text X", "-3"], ["Reference text Y", "5"], ["Center X", "-6"], ["Center Y", "0"]]) {
  const input = page.getByRole("spinbutton", { name, exact: true });
  await input.fill(value); await input.press("Tab");
 }
 const secondLabel = await labelScreen(page, 2);
 await page.mouse.click(secondLabel.x, secondLabel.y);
 const secondCenter = page.getByRole("spinbutton", { name: "Center X", exact: true });
 await secondCenter.fill("6"); await secondCenter.press("Tab");
 await expect.poll(async () => JSON.parse((await page.locator("#editor-scene").textContent())!).shapes.find((shape: { name: string }) => shape.name === "symbol 1")?.x).toBe(-6);
 const reviewLabel = await labelScreen(page, 1);
 await page.mouse.click(reviewLabel.x, reviewLabel.y);
 await expect(xInput).toHaveValue("-3");
 for (let repeat = 0; repeat < 10; repeat++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
 await page.screenshot({ path: test.info().outputPath("symbol-text-positions.png") });
});

test("saved symbol label positions survive a project reload without copying the definition", async ({ page }) => {
 await page.goto("/tests/browser/projects.html");
 await page.getByLabel("Project name", { exact: true }).fill("Text positions");
 await page.getByRole("button", { name: "Create project", exact: true }).click();
 await expect(page.getByLabel("Project save status")).toHaveText("Saved");
 await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
 const box = (await page.locator("canvas").boundingBox())!;
 await page.locator("canvas").click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
 const input = page.getByRole("spinbutton", { name: "Reference text X", exact: true });
 await input.fill("18"); await input.press("Tab");
 const projectState = async () => JSON.parse((await page.locator("#project-document").textContent())!);
 await expect.poll(async () => (await projectState()).dirty).toBe(false);
 const saved = await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("Text positions");
  const formatPath = "/packages/core/src/projects/format.ts";
  const { parseProjectManifest } = await import(formatPath);
  const manifest = parseProjectManifest(await (await (await directory.getFileHandle(".ecadprj")).getFile()).text());
  const parts = manifest.drawing.split("/");
  const file = parts.pop()!;
  let parent = directory;
  for (const part of parts) parent = await parent.getDirectoryHandle(part);
  return JSON.parse(await (await (await parent.getFileHandle(file)).getFile()).text());
 });
 expect(saved.shapes[0].textPositions.reference.x).toBe(18);
 expect(saved.shapes[0]).not.toHaveProperty("texts");
 expect(saved.shapes[0]).not.toHaveProperty("children");
 await page.reload();
 await expect.poll(async () => (await projectState()).shapes[0]?.textPositions?.reference?.x).toBe(18);
 await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
 await expect(page.locator("canvas")).toBeVisible();
 await expect(page.getByRole("alert")).toHaveCount(0);
});

test("symbol labels snap at one-tenth of the grid spacing in world coordinates", async ({ page }) => {
 await page.goto("/tests/browser/editor.html");
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
 const box = (await page.locator("canvas").boundingBox())!;
 await page.locator("canvas").click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
 for (const [attribute, y] of [["Reference", "12"], ["Value", "-12"]]) {
  const input = page.getByRole("spinbutton", { name: `${attribute} text Y`, exact: true });
  await input.fill(y);
  await input.press("Tab");
 }
 const step = Number((await page.getByRole("button", { name: "Snap to grid", exact: true }).getAttribute("title"))!.match(/[\d.]+/)![0]) / 10;
 for (const angle of [0, 90]) {
  const input = page.getByRole("spinbutton", { name: "Angle", exact: true });
  await input.fill(String(angle));
  await input.press("Tab");
  await expect.poll(async () => JSON.parse((await page.locator("#editor-scene").textContent())!).shapes[0].rotation).toBeCloseTo(angle * Math.PI / 180);
  for (const attribute of ["reference", "value"]) {
   const before = await state(page);
   const scene = JSON.parse((await page.locator("#editor-scene").textContent())!);
   const label = scene.symbolTexts.find((text: { name: string }) => text.name === `${attribute} 1`);
   const scale = (scene.corner[0] - scene.origin[0]) / 420 * box.width / 2;
   const start = await labelScreen(page, 1, attribute);
   await page.mouse.move(start.x, start.y);
   await page.mouse.down();
   await page.mouse.move(start.x + 3.4 * step * scale, start.y - 2.6 * step * scale, { steps: 4 });
   expect(await state(page)).toEqual(before);
   await page.mouse.up();
   const moved = await state(page);
   expect(moved.historySize).toBe(before.historySize + 1);
   const { textPositions: _beforePositions, ...beforeBody } = before.shapes[0];
   const { textPositions: _afterPositions, ...afterBody } = moved.shapes[0];
   expect(afterBody).toEqual(beforeBody);
   await expect.poll(async () => {
    const updated = JSON.parse((await page.locator("#editor-scene").textContent())!).symbolTexts.find((text: { name: string }) => text.name === `${attribute} 1`);
    return [Number(updated.x.toFixed(6)), Number(updated.y.toFixed(6))];
   }).toEqual([Number((Math.round((label.x + 3.4 * step) / step) * step).toFixed(6)), Number((Math.round((label.y + 2.6 * step) / step) * step).toFixed(6))]);
  }
 }
 for (let zoom = 0; zoom < 8; zoom++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
 await page.screenshot({ path: test.info().outputPath("symbol-text-fine-snapping.png") });
});

test("Alt-dragging a moved label duplicates the symbol and keeps label edits independent", async ({ page }) => {
 await page.goto("/tests/browser/editor.html");
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
 const box = (await page.locator("canvas").boundingBox())!;
 await page.locator("canvas").click({ position: { x: box.width * 0.45, y: box.height * 0.5 } });
 await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
 for (const [axis, value] of [["X", "-8"], ["Y", "8"]]) {
  const input = page.getByRole("spinbutton", { name: `Reference text ${axis}`, exact: true });
  await input.fill(value); await input.press("Tab");
 }
 const before = await state(page);
 await expect.poll(async () => JSON.parse((await page.locator("#editor-scene").textContent())!).symbolTexts[0]?.x).toBeCloseTo(before.shapes[0].x - 8);
 await expect.poll(async () => JSON.parse((await page.locator("#editor-scene").textContent())!).symbolTexts[0]?.y).toBeCloseTo(before.shapes[0].y + 8);
 const start = await labelScreen(page, 1);
 await page.keyboard.down("Alt");
 await page.mouse.move(start.x, start.y);
 await page.mouse.down();
 await page.mouse.move(start.x + 140, start.y + 45, { steps: 8 });
 expect(await state(page)).toEqual(before);
 await page.mouse.up();
 await page.keyboard.up("Alt");
 const duplicated = await state(page);
 expect(duplicated.shapes).toHaveLength(2);
 expect(duplicated.historySize).toBe(before.historySize + 1);
 expect(duplicated.shapes[0]).toEqual(before.shapes[0]);
 expect(duplicated.shapes[1].textPositions).toEqual(before.shapes[0].textPositions);
 expect(duplicated.shapes[1].attributes.reference).toBe("R2");
 expect(duplicated.shapes[1].x).not.toBe(duplicated.shapes[0].x);
 await expect.poll(async () => JSON.parse((await page.locator("#editor-scene").textContent())!).symbolTexts.length).toBe(4);
 await expect.poll(async () => (await labelScreen(page, 2)).x).toBeCloseTo(start.x + 140, 2);
 await expect.poll(async () => (await labelScreen(page, 2)).y).toBeCloseTo(start.y + 45, 2);
 const copyLabel = await labelScreen(page, 2);
 expect(copyLabel.x).toBeCloseTo(start.x + 140, 2);
 expect(copyLabel.y).toBeCloseTo(start.y + 45, 2);
 await page.mouse.move(copyLabel.x, copyLabel.y);
 await page.mouse.down();
 await page.mouse.move(copyLabel.x + 35, copyLabel.y - 30, { steps: 5 });
 await page.mouse.up();
 const edited = await state(page);
 expect(edited.shapes[0]).toEqual(before.shapes[0]);
 expect(edited.shapes[1].textPositions).not.toEqual(duplicated.shapes[1].textPositions);
 expect(edited.shapes[1].x).toBe(duplicated.shapes[1].x);
 expect(edited.shapes[1].y).toBe(duplicated.shapes[1].y);
 await (await toolbarButton(page, "Undo")).click();
 expect((await state(page)).shapes).toEqual(duplicated.shapes);
 await (await toolbarButton(page, "Undo")).click();
 expect((await state(page)).shapes).toEqual(before.shapes);
 await (await toolbarButton(page, "Redo")).click();
 expect((await state(page)).shapes).toEqual(duplicated.shapes);
 await expect(page.getByRole("alert")).toHaveCount(0);
});
