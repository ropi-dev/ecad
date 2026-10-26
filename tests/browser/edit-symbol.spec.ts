import { openProjectFiles } from "./project-files";
import { expect, test, type Page } from "@playwright/test";
import { toolbarButton } from "./toolbar";

const documentState = async (page: Page) =>
 JSON.parse((await page.locator("#project-document").textContent())!);

test.use({ viewport: { width: 1440, height: 1000 } });

test("attributes open and save the reusable project symbol definition", async ({ page }) => {
 const errors: string[] = [];
 page.on("pageerror", (error) => errors.push(error.message));
 await page.goto("/tests/browser/projects.html");
 await page.getByLabel("Project name", { exact: true }).fill("Definition editing");
 await page.getByRole("button", { name: "Create project", exact: true }).click();
 const symbol = {
  format: "ecad-symbol", version: 1, units: "mm", id: "editable-part",
  name: "Editable part", description: "Preserve library metadata", prefix: "TP", value: "Signal",
  shapes: [{ kind: "rectangle", x: 0, y: 0, width: 10, height: 6 }, { kind: "pin", name: "Signal", x: -6, y: 0 }],
 };
 await expect((await openProjectFiles(page)).getByLabel("Add symbol files")).toBeEnabled();
 await (await openProjectFiles(page)).getByLabel("Add symbol files").setInputFiles({
  name: "part.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(symbol)),
 });
 await (await openProjectFiles(page)).getByRole("link", { name: "Open Drawing", exact: true }).click();
 await expect(page.getByRole("button", { name: "Edit symbol", exact: true })).toHaveCount(0);
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Editable part", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 600, y: 450 } });
 // The instance name can differ from the definition name.
 await page.getByRole("textbox", { name: "Name", exact: true }).fill("Renamed instance");
 await page.getByRole("textbox", { name: "Name", exact: true }).press("Tab");
 const schematic = (await documentState(page)).shapes;
 const edit = page.getByRole("button", { name: "Edit symbol", exact: true });
 await expect(edit).toBeEnabled();
 await page.screenshot({ path: test.info().outputPath("attributes.png") });
 await edit.click();
 await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Editable part");
 await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(0);
 await expect(page.getByRole("button", { name: "Edit symbol", exact: true })).toHaveCount(0);
 await (await toolbarButton(page, "Rectangle")).click();
 await page.mouse.move(450, 350);
 await page.mouse.down();
 await page.mouse.move(550, 420);
 await page.mouse.up();
 await expect.poll(async () => (await documentState(page)).symbols[0].shapes.length).toBe(3);
 const saved = (await documentState(page)).symbols[0];
 expect(saved).toMatchObject({ ...symbol, shapes: expect.any(Array) });
 expect(saved.shapes.slice(0, 2)).toMatchObject(symbol.shapes);
 expect((await documentState(page)).shapes).toEqual(schematic);
 await (await openProjectFiles(page)).getByRole("link", { name: "Projects", exact: true }).click();
 await (await openProjectFiles(page)).getByRole("link", { name: "Open Drawing", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Editable part", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 450, y: 550 } });
 const updated = (await documentState(page)).shapes;
 expect(updated[0]).toEqual(schematic[0]);
 expect(updated[1].children).toHaveLength(3);
 expect(errors).toEqual([]);
});

test("symbols without an editable project definition explain why editing is unavailable", async ({ page }) => {
 await page.goto("/tests/browser/editor.html");
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 600, y: 450 } });
 const edit = page.getByRole("button", { name: "Edit symbol", exact: true });
 await expect(edit).toBeDisabled();
 await expect(edit).toHaveAttribute("title", "This symbol's definition is read-only or unavailable.");
 await page.getByRole("button", { name: "Clear selection", exact: true }).click();
 await expect(edit).toHaveCount(0);
});

const userFile = {
 format: "ecad-symbol", version: 1, units: "mm", id: "user-part", name: "User part",
 description: "Keep user metadata", prefix: "TP", value: "Signal",
 shapes: [{ kind: "rectangle", x: 0, y: 0, width: 10, height: 6 }],
};

async function openUserDefinition(page: Page) {
 await page.goto("/tests/browser/editor.html");
 await page.evaluate((file) => localStorage.setItem("ecad.user-config.v1", JSON.stringify({
  version: 1, symbolLibraries: [
   { id: "earlier", name: "Earlier", enabled: true, source: { kind: "embedded", symbols: [{ ...file, name: "Earlier part" }] } },
   { id: "user", name: "User", enabled: true, source: { kind: "embedded", symbols: [file] } },
  ],
 })), userFile);
 await page.reload();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert User part", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 600, y: 450 } });
 await page.getByRole("button", { name: "Edit symbol", exact: true }).click();
 await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · User part");
 await (await toolbarButton(page, "Rectangle")).click();
 await page.mouse.move(450, 350);
 await page.mouse.down();
 await page.mouse.move(550, 420);
 await page.mouse.up();
}

test("user library definitions save without a project and preserve earlier libraries", async ({ page }) => {
 await openUserDefinition(page);
 await expect(page.getByRole("status")).toHaveText("Saved");
 const config = await page.evaluate(() => JSON.parse(localStorage.getItem("ecad.user-config.v1")!));
 expect(config.symbolLibraries[0].source.symbols[0].shapes).toHaveLength(1);
 expect(config.symbolLibraries[1].source.symbols[0]).toMatchObject({ ...userFile, shapes: expect.any(Array) });
 expect(config.symbolLibraries[1].source.symbols[0].shapes).toHaveLength(2);
 await page.getByRole("button", { name: "Back to schematic", exact: true }).click();
 await expect(page.getByRole("heading", { level: 1 })).toContainText("Schematic editor");
 expect(JSON.parse((await page.locator("#editor-document").textContent())!).shapes[0].children).toHaveLength(1);
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert User part", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 450, y: 550 } });
 expect(JSON.parse((await page.locator("#editor-document").textContent())!).shapes[1].children).toHaveLength(2);
});

test("failed user definition saves retain edits and support retry", async ({ page }) => {
 // Install failure before the first edit's autosave runs.
 await page.goto("/tests/browser/editor.html");
 await page.evaluate((file) => localStorage.setItem("ecad.user-config.v1", JSON.stringify({ version: 1, symbolLibraries: [{ id: "user", name: "User", enabled: true, source: { kind: "embedded", symbols: [file] } }] })), userFile);
 await page.reload();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert User part", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 600, y: 450 } });
 await page.getByRole("button", { name: "Edit symbol", exact: true }).click();
 await page.evaluate(() => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
   if (key === "ecad.user-config.v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
   return original.call(this, key, value);
  };
  window.addEventListener("restore-storage", () => { Storage.prototype.setItem = original; }, { once: true });
 });
 await (await toolbarButton(page, "Rectangle")).click();
 await page.mouse.move(450, 350);
 await page.mouse.down();
 await page.mouse.move(550, 420);
 await page.mouse.up();
 await expect(page.getByRole("alert")).toContainText("Unable to save the symbol definition");
 await expect(page.getByRole("status")).toHaveText("Unsaved changes");
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ecad.user-config.v1")!).symbolLibraries[0].source.symbols[0].shapes.length)).toBe(1);
 await page.evaluate(() => window.dispatchEvent(new Event("restore-storage")));
 await page.getByRole("button", { name: "Save symbol", exact: true }).click();
 await expect(page.getByRole("status")).toHaveText("Saved");
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ecad.user-config.v1")!).symbolLibraries[0].source.symbols[0].shapes.length)).toBe(2);
});

test("a validation error can be corrected and saved in the same editor", async ({ page }) => {
 await page.goto("/tests/browser/editor.html");
 await page.evaluate((file) => localStorage.setItem("ecad.user-config.v1", JSON.stringify({
  version: 1, symbolLibraries: [{ id: "user", name: "User", enabled: true, source: { kind: "embedded", symbols: [{ ...file, shapes: Array.from({ length: 256 }, (_, i) => ({ kind: "pin", name: `Pin ${i}`, x: (i % 16) * 2, y: Math.floor(i / 16) * 2 })) }] } }],
 })), userFile);
 await page.reload();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert User part", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 600, y: 450 } });
 await page.getByRole("button", { name: "Edit symbol", exact: true }).click();
 await (await toolbarButton(page, "Rectangle")).click();
 await page.mouse.move(450, 350);
 await page.mouse.down();
 await page.mouse.move(550, 420);
 await page.mouse.up();
 await expect(page.getByRole("alert")).toContainText("Invalid symbol file");
 await page.keyboard.press("Delete");
 await expect(page.getByRole("status")).toHaveText("Saved");
 await expect(page.getByRole("alert")).toHaveCount(0);
 await page.getByRole("button", { name: "Back to schematic", exact: true }).click();
 await expect(page.getByRole("heading", { level: 1 })).toContainText("Schematic editor");
});

test("nested symbol editing saves only library references and reopens them", async ({ page }) => {
 const errors: string[] = [];
 page.on("pageerror", error => errors.push(error.message));
 await page.goto("/tests/browser/projects.html");
 await page.getByLabel("Project name", { exact: true }).fill("Nested references");
 await page.getByRole("button", { name: "Create project", exact: true }).click();
 await (await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true }).click();
 await page.getByRole("menuitem", { name: "New symbol", exact: true }).click();
 await page.getByLabel("Symbol name", { exact: true }).fill("Composite part");
 await page.getByRole("button", { name: "Create symbol", exact: true }).click();
 await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Composite part");
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
 await page.locator("canvas").click({ position: { x: 600, y: 450 } });
 await expect.poll(async () => (await documentState(page)).symbols[0].shapes.length).toBe(1);
 const saved = (await documentState(page)).symbols[0].shapes[0];
 expect(saved).toMatchObject({ kind: "symbol", library: { scope: "user", id: "builtin" }, definitionId: "resistor" });
 expect(saved).not.toHaveProperty("children");
 expect(saved).not.toHaveProperty("texts");
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link", { name: "Open composite-part.ecadsym", exact: true }).click();
 await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Composite part");
 await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
 await expect(page.getByRole("alert")).toHaveCount(0);
 expect((await documentState(page)).editorShapes[0]).toMatchObject({ kind: "symbol", library: { scope: "user", id: "builtin" }, definitionId: "resistor" });
 expect(errors).toEqual([]);
});
