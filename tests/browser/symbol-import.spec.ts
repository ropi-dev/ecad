import { generateDefaultSymbols } from "@ecad/default-symbols";
import { toolbarButton } from "./toolbar";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test as base, type Page } from "@playwright/test";

const example = readFileSync(new URL("../../packages/web/public/examples/symbols/test-point.ecadsym", import.meta.url));
const upload = { name: "test-point.ecadsym", mimeType: "application/json", buffer: example };
const bufferUpload = { name: "buffer.ecadsym", mimeType: "application/json", buffer: readFileSync(new URL("../../packages/web/public/examples/symbols/buffer.ecadsym", import.meta.url)) };
const storageKey = "ecad.user-config.v1";

// Library management lives on Projects; the editor only selects symbols.
const test = base.extend<{ libraries: Page }>({
 libraries: async ({ context }, use) => {
  const libraries = await context.newPage();
  await libraries.goto("/tests/browser/projects.html");
  await libraries.getByText("Symbol libraries", { exact: true }).click();
  await expect(libraries.getByLabel("Upload symbol files")).toBeEnabled();
  await use(libraries);
  await libraries.close();
 },
});

test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ page, libraries }) => {
 await expect(libraries.getByLabel("Upload symbol files")).toBeEnabled();
 await page.goto("/tests/browser/editor.html");
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
});

test("uploads, previews, places, undoes, and restores custom symbols after reload", async ({ page, libraries }) => {
 const errors: string[] = [];
 page.on("pageerror", error => errors.push(error.message));
 const download = libraries.waitForEvent("download");
 await libraries.getByRole("link", { name: "Download example" }).click();
 expect((await download).suggestedFilename()).toBe("test-point.ecadsym");
 await libraries.getByLabel("Upload symbol files").setInputFiles([upload, bufferUpload]);
 await expect(libraries.getByRole("status")).toContainText("Added 2 symbols. Saved in this browser.");
 const custom = page.getByRole("region", { name: "Custom symbols", exact: true });
 await expect(custom.getByRole("button", { name: /^Insert / })).toHaveCount(2);
 await expect(custom.getByRole("button", { name: "Insert Test point", exact: true })).toBeVisible();
 const search = page.getByRole("searchbox", { name: "Search symbols" });
 await search.fill("  TEST POINT  ");
 await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(1);
 await expect(custom.getByRole("button", { name: "Insert Test point", exact: true })).toBeVisible();
 await search.fill("");
 const testPoint = page.getByRole("button", { name: "Insert Test point", exact: true });
 await expect(testPoint.locator("svg circle")).toHaveCount(2);
 await expect(page.getByRole("button", { name: "Insert Buffer" }).locator("svg polygon")).toHaveCount(1);
 await testPoint.click();
 const canvas = page.locator("canvas");
 const box = (await canvas.boundingBox())!;
 await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
 await expect(page.getByRole("textbox", { name: "Reference", exact: true })).toHaveValue("TP1");
 await expect(page.getByRole("textbox", { name: "Value", exact: true })).toHaveValue("Test");
 await expect.poll(async () => JSON.parse((await page.locator("#editor-scene").textContent())!).shapes.length).toBe(1);
 await (await toolbarButton(page, "Undo")).click();
 await expect.poll(async () => JSON.parse((await page.locator("#editor-scene").textContent())!).shapes.length).toBe(0);
 await (await toolbarButton(page, "Redo")).click();
 await expect.poll(async () => JSON.parse((await page.locator("#editor-scene").textContent())!).shapes.length).toBe(1);
 await page.reload();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(testPoint).toBeVisible();
 await expect(page.getByRole("button", { name: "Insert Buffer" })).toBeVisible();
 await expect(page.getByRole("button", { name: "Insert Resistor", exact: true })).toBeVisible();
 expect(errors).toEqual([]);
});

test("invalid and repeated uploads preserve the library and allow retrying the same file", async ({ page, libraries }) => {
 const input = libraries.getByLabel("Upload symbol files");
 await input.setInputFiles({ ...upload, buffer: Buffer.from("{") });
 await expect(libraries.getByRole("alert")).toContainText("Invalid JSON");
 await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(generateDefaultSymbols().length);
 await input.setInputFiles([upload, bufferUpload]);
 await expect(libraries.getByRole("status")).toContainText("Added 2 symbols");
 await expect(libraries.getByRole("alert")).toHaveCount(0);
 const saved = await page.evaluate(key => localStorage.getItem(key), storageKey);
 await input.setInputFiles([upload, bufferUpload]);
 await expect(libraries.getByRole("alert")).toContainText("duplicated");
 await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(generateDefaultSymbols().length + 2);
 expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(saved);
 const mixed = JSON.parse(example.toString());
 mixed.id = "new-symbol";
 const bad = { ...mixed, id: "invalid-symbol", shapes: [{ kind: "circle", x: 0, y: 0, radius: -1 }] };
 await input.setInputFiles([{ ...upload, buffer: Buffer.from(JSON.stringify(mixed)) }, { ...bufferUpload, buffer: Buffer.from(JSON.stringify(bad)) }]);
 await expect(libraries.getByRole("alert")).toContainText("Invalid symbol file");
 await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(generateDefaultSymbols().length + 2);
 expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(saved);
});

test("storage failures keep imports usable and report their temporary lifetime", async ({ libraries }) => {
 await libraries.evaluate(() => {
  Storage.prototype.setItem = () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); };
 });
 await libraries.getByLabel("Upload symbol files").setInputFiles([upload, bufferUpload]);
 await expect(libraries.getByRole("status")).toContainText("Browser storage is unavailable");
 await libraries.getByRole("link", { name: "Schematic editor", exact: true }).click();
 await libraries.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(libraries.getByRole("button", { name: "Insert Test point" })).toBeVisible();
});

test("corrupt saved libraries leave built-ins available and can be replaced", async ({ page, libraries }) => {
 await page.evaluate(key => localStorage.setItem(key, "{"), storageKey);
 await page.reload();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(libraries.getByRole("alert")).toContainText("Saved symbols could not be loaded");
 await expect(page.getByRole("button", { name: "Insert Resistor", exact: true })).toBeVisible();
 await libraries.getByLabel("Upload symbol files").setInputFiles([upload, bufferUpload]);
 await expect(libraries.getByRole("status")).toContainText("Added 2 symbols");
 await expect(libraries.getByRole("alert")).toHaveCount(0);
});

test("a library is a directory of standalone symbols, with unrelated files ignored", async ({ page, libraries }) => {
 const directory = mkdtempSync(join(tmpdir(), "ecad-symbol-library-"));
 try {
  writeFileSync(join(directory, "test-point.ecadsym"), example);
  writeFileSync(join(directory, "buffer.ecadsym"), bufferUpload.buffer);
  writeFileSync(join(directory, "README.md"), "One symbol per file.");
  const input = libraries.getByLabel("Upload symbol directory");
  await expect(input).toHaveAttribute("webkitdirectory", "");
  await input.setInputFiles(directory);
  await expect(libraries.getByRole("status")).toContainText("Added 2 symbols");
  await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(generateDefaultSymbols().length + 2);
 } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("named user libraries can be disabled and removed without legacy symbols returning", async ({ page, libraries }) => {
 await page.evaluate((symbolText) => {
  localStorage.removeItem("ecad.user-config.v1");
  localStorage.setItem("ecad.symbol-library.v1", JSON.stringify([JSON.parse(symbolText)]));
 }, example.toString());
 await libraries.reload();
 await libraries.getByText("Symbol libraries", { exact: true }).click();
 await page.reload();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 const userLibraries = libraries.getByRole("group", { name: "User libraries", exact: true });
 await expect(page.getByRole("button", { name: "Insert Test point" })).toBeVisible();
 await userLibraries.getByRole("checkbox", { name: "Imported symbols", exact: true }).uncheck();
 await expect(page.getByRole("button", { name: "Insert Test point" })).toHaveCount(0);
 await expect(page.getByRole("region", { name: "Custom symbols", exact: true })).toHaveCount(0);
 await page.reload();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(userLibraries.getByRole("checkbox", { name: "Imported symbols", exact: true })).not.toBeChecked();
 await userLibraries.getByRole("checkbox", { name: "Imported symbols", exact: true }).check();
 await expect(page.getByRole("button", { name: "Insert Test point" })).toBeVisible();
 await userLibraries.getByRole("button", { name: "Remove Imported symbols" }).click();
 await expect(page.getByRole("button", { name: "Insert Test point" })).toHaveCount(0);
 await userLibraries.getByRole("checkbox", { name: "Built-in symbols" }).uncheck();
 await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(0);
 await page.reload();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(0);
});


test("user configuration changes update another open editor", async ({ context, libraries }) => {
 const other = await context.newPage();
 await other.goto("/tests/browser/editor.html");
 await other.getByRole("button", { name: "Symbols", exact: true }).click();
 await libraries.getByLabel("Upload symbol files").setInputFiles(upload);
 await expect(libraries.getByRole("status")).toContainText("Added 1 symbol");
 await expect(other.getByRole("button", { name: "Insert Test point" })).toBeVisible();
 await libraries.getByRole("group", { name: "User libraries", exact: true }).getByRole("checkbox", { name: "Imported symbols" }).uncheck();
 await expect(other.getByRole("button", { name: "Insert Test point" })).toHaveCount(0);
 await other.close();
});
