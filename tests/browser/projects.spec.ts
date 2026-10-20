import { toolbarButton } from "./toolbar";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const documentState = async (page: Page) => JSON.parse(await page.locator("#project-document").textContent() ?? "{}");
async function projectsPage(page: Page) {
	await expect(page.locator("#project-document")).toBeAttached();
	if (!(await page.getByRole("heading", { name: "Projects", exact: true }).isVisible())) {
		await page.getByRole("link", { name: "Projects", exact: true }).click();
	}
	await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
}
async function createProject(page: Page, name: string) {
	await projectsPage(page);
	await page.getByLabel("Project name", { exact: true }).fill(name);
	await page.getByRole("button", { name: "Create project", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).name).toBe(name);
	await expect(page.getByLabel("Project save status")).toHaveText("Saved");
}
async function drawRectangle(page: Page) {
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400);
	await page.mouse.up();
}

test("the global project preserves drawings and undo history across page navigation", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "History");
	await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(1);
	const original = (await documentState(page)).shapes;
	await projectsPage(page);
	await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).shapes).toEqual(original);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await documentState(page)).shapes).toEqual(original);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	await page.reload();
	await expect.poll(async () => (await documentState(page)).shapes).toEqual(original);
});

test("projects manage symbols on a separate page and isolate switched projects", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "First");
	await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(1);
	const original = (await documentState(page)).shapes;
	await projectsPage(page);
	await page.getByLabel("Add symbol files").setInputFiles({ name: "sample.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "ecad-symbol", version: 1, units: "mm", id: "project-symbol", name: "Project symbol", description: "", prefix: "TP", value: "", shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }] })) });
	await expect(page.getByText("project-symbol.ecadsym", { exact: true })).toBeVisible();
	await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(page.getByRole("button", { name: "Insert Project symbol", exact: true })).toBeVisible();
	await expect(page.getByLabel("Upload symbol files")).toHaveCount(0);
	await expect(page.getByText("project-symbol.ecadsym", { exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.reload();
	await expect.poll(async () => (await documentState(page)).shapes).toEqual(original);
	await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(page.getByRole("button", { name: "Insert Project symbol", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await createProject(page, "Second");
	await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await page.mouse.click(650, 350);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(0);
	await projectsPage(page);
	await page.getByRole("button", { name: "First", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).name).toBe("First");
	await expect.poll(async () => (await documentState(page)).shapes).toEqual(original);
});

test("project Gerber files are imported and listed only on the Projects page", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Board");
	const gerber = "%FSLAX24Y24*%\n%MOMM*%\n%ADD10C,1*%\nD10*\nX000000Y000000D03*\nM02*";
	await page.getByLabel("Add Gerber files").setInputFiles({ name: "board.gbr", mimeType: "text/plain", buffer: Buffer.from(gerber) });
	await expect.poll(async () => (await documentState(page)).assets?.length).toBe(1);
	await expect(page.getByText("board.gbr", { exact: true })).toBeVisible();
	await page.getByRole("link", { name: "Open board.gbr", exact: true }).click();
	await expect(page.locator("canvas")).toBeVisible();
	await expect(page.getByLabel("Open Gerber file")).toHaveCount(0);
	await expect(page.getByText("board.gbr", { exact: true })).toHaveCount(0);
	await projectsPage(page);
	await page.reload();
	await expect.poll(async () => (await documentState(page)).name).toBe("Board");
	await expect(page.getByText("board.gbr", { exact: true })).toBeVisible();
	await expect.poll(async () => (await documentState(page)).assets?.length).toBe(1);
});

test("project STEP files are opened from the Projects page and copied with new projects", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Model");
	await page.getByLabel("Add STEP files").setInputFiles(resolve("node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp"));
	await expect.poll(async () => (await documentState(page)).assets?.length).toBe(1);
	await page.getByRole("link", { name: "Open cube.stp", exact: true }).click();
	await expect(page.getByRole("button", { name: "Fit model", exact: true })).toBeEnabled({ timeout: 30000 });
	await expect(page.getByLabel("Open STEP file")).toHaveCount(0);
	await expect(page.getByText("cube.stp", { exact: true })).toHaveCount(0);
	await createProject(page, "Model copy");
	await expect.poll(async () => (await documentState(page)).assets?.length).toBe(1);
	await page.reload();
	await expect.poll(async () => (await documentState(page)).name).toBe("Model copy");
	await page.getByRole("link", { name: "Open cube.stp", exact: true }).click();
	await expect(page.getByRole("button", { name: "Fit model", exact: true })).toBeEnabled({ timeout: 30000 });
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("user libraries remain available across projects while named project overrides persist separately", async ({ page }) => {
 await page.goto("/tests/browser/projects.html");
 await page.getByText("Symbol libraries", { exact: true }).click();
 await page.getByLabel("Library name", { exact: true }).fill("User parts");
 const symbol = { format: "ecad-symbol", version: 1, units: "mm", id: "shared-part", name: "User point", description: "", prefix: "TP", value: "", shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }] };
 const upload = { name: "point.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(symbol)) };
 await page.getByLabel("Upload symbol files").setInputFiles(upload);
 await expect(page.getByText("Added 1 symbol. Saved in this browser.", { exact: true })).toBeVisible();
 const savedUser = await page.evaluate(() => localStorage.getItem("ecad.user-config.v1"));
 await createProject(page, "Libraries first");
 await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(page.getByRole("button", { name: "Insert User point", exact: true })).toBeVisible();
 await page.keyboard.press("Escape");
 await projectsPage(page);
 await page.getByText("Symbol libraries", { exact: true }).click();
 await page.getByLabel("Library scope").selectOption("project");
 await page.getByLabel("Library name", { exact: true }).fill("Project parts");
 await page.getByLabel("Upload symbol files").setInputFiles({ ...upload, buffer: Buffer.from(JSON.stringify({ ...symbol, name: "Project point" })) });
 await expect(page.getByText("Added 1 symbol. Saved in this project.", { exact: true })).toBeVisible();
 expect(await page.evaluate(() => localStorage.getItem("ecad.user-config.v1"))).toBe(savedUser);
 await page.reload();
 await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(page.getByRole("button", { name: "Insert Project point", exact: true })).toBeVisible();
 await expect(page.getByRole("button", { name: "Insert User point", exact: true })).toHaveCount(0);
 await page.keyboard.press("Escape");
 await projectsPage(page);
 await page.getByText("Symbol libraries", { exact: true }).click();
 const projectLibraries = page.getByRole("group", { name: "Project libraries", exact: true });
 await projectLibraries.getByRole("checkbox", { name: "Project parts", exact: true }).uncheck();
 await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(page.getByRole("button", { name: "Insert User point", exact: true })).toBeVisible();
 await page.keyboard.press("Escape");
 await createProject(page, "Libraries second");
 await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(page.getByRole("button", { name: "Insert User point", exact: true })).toBeVisible();
 expect(await page.evaluate(() => localStorage.getItem("ecad.user-config.v1"))).toBe(savedUser);
});

test("failed project library configuration saves restore the checkbox and saved definitions", async ({ page }) => {
 await page.goto("/tests/browser/projects.html");
 await createProject(page, "Library rollback");
 await page.getByLabel("Add symbol files").setInputFiles({ name: "point.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "ecad-symbol", version: 1, units: "mm", id: "rollback-point", name: "Rollback point", description: "", prefix: "TP", value: "", shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }] })) });
 await expect(page.getByText("rollback-point.ecadsym", { exact: true })).toBeVisible();
 await page.getByText("Symbol libraries", { exact: true }).click();
 await page.evaluate(() => {
  const createWritable = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = function(...args) {
   if (this.name === ".ecadprj") throw new DOMException("Quota exceeded", "QuotaExceededError");
   return createWritable.apply(this, args);
  };
 });
 const enabled = page.getByRole("group", { name: "Project libraries", exact: true }).getByRole("checkbox", { name: "Project symbols", exact: true });
 await enabled.uncheck();
 await expect(page.getByRole("alert")).toContainText("Quota exceeded");
 await expect(enabled).toBeChecked();
 await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(page.getByRole("button", { name: "Insert Rollback point", exact: true })).toBeVisible();
});

test("opening a symbol file removes the worksheet and edits only that symbol", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "File editing");
	await page.getByRole("link", { name: "Open Drawing", exact: true }).click();
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(1);
	const schematic = (await documentState(page)).shapes;
	await projectsPage(page);
	const symbol = { format: "ecad-symbol", version: 1, units: "mm", id: "editable-symbol", name: "Editable symbol", description: "Keep this metadata", prefix: "TP", value: "Signal", shapes: [{ kind: "rectangle", x: 3, y: -2, width: 10, height: 6 }, { kind: "pin", name: "Signal", x: -4, y: 0 }] };
	await page.getByLabel("Add symbol files").setInputFiles({ name: "editable-symbol.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(symbol)) });
	await page.getByRole("link", { name: "Open editable-symbol.ecadsym", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Editable symbol");
	await expect(page.locator("html")).toHaveAttribute("data-worksheet", "none");
	await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(0);
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(2);
	await page.screenshot({ path: test.info().outputPath("symbol-file.png") });
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(3);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	const saved = (await documentState(page)).symbols[0];
	expect(saved).toMatchObject({ ...symbol, shapes: expect.any(Array) });
	expect(saved.shapes).toHaveLength(3);
	expect(saved.shapes.slice(0, 2)).toMatchObject(symbol.shapes);
	expect((await documentState(page)).shapes).toEqual(schematic);
	await projectsPage(page);
	await page.getByRole("link", { name: "Open Drawing", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Schematic editor · A3");
	await expect(page.locator("html")).toHaveAttribute("data-worksheet", "A3, 420 × 297 mm");
	await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(1);
	await page.screenshot({ path: test.info().outputPath("schematic-file.png") });
	expect((await documentState(page)).shapes).toEqual(schematic);
	await projectsPage(page);
	await page.getByRole("link", { name: "Open editable-symbol.ecadsym", exact: true }).click();
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(2);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(3);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	await page.reload();
	await page.getByRole("link", { name: "Open editable-symbol.ecadsym", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-worksheet", "none");
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(3);
	expect((await documentState(page)).shapes).toEqual(schematic);
});

test("failed symbol saves keep edits available for retry and leave the schematic untouched", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Symbol save retry");
	await expect(page.getByLabel("Add symbol files")).toBeEnabled();
	await page.getByLabel("Add symbol files").setInputFiles({ name: "retry.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "ecad-symbol", version: 1, units: "mm", id: "retry-symbol", name: "Retry symbol", description: "", prefix: "TP", value: "", shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }] })) });
	await page.getByRole("link", { name: "Open retry-symbol.ecadsym", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-worksheet", "none");
	await page.evaluate(() => {
		const original = FileSystemFileHandle.prototype.createWritable;
		FileSystemFileHandle.prototype.createWritable = function(...args) {
			if (this.name === ".ecadprj") throw new DOMException("Quota exceeded", "QuotaExceededError");
			return original.apply(this, args);
		};
		window.addEventListener("restore-writes", () => { FileSystemFileHandle.prototype.createWritable = original; }, { once: true });
	});
	await drawRectangle(page);
	await expect(page.getByRole("alert")).toContainText("Quota exceeded");
	expect((await documentState(page)).editorShapes).toHaveLength(2);
	expect((await documentState(page)).symbols[0].shapes).toHaveLength(1);
	expect((await documentState(page)).shapes).toEqual([]);
	expect((await documentState(page)).dirty).toBe(true);
	await page.evaluate(() => window.dispatchEvent(new Event("restore-writes")));
	await projectsPage(page);
	await page.getByRole("button", { name: "Save project", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	expect((await documentState(page)).symbols[0].shapes).toHaveLength(2);
	await page.reload();
	await page.getByRole("link", { name: "Open retry-symbol.ecadsym", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(2);
	expect((await documentState(page)).shapes).toEqual([]);
});

test("new symbols start empty, persist edits, and use distinct files for repeated names", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await expect(page.getByRole("button", { name: "New symbol", exact: true })).toHaveCount(0);
	await createProject(page, "New symbols");
	await page.getByRole("button", { name: "New symbol", exact: true }).click();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	expect((await documentState(page)).symbols).toEqual([]);
	const create = async () => {
		await page.getByRole("button", { name: "New symbol", exact: true }).click();
		await expect(page.getByLabel("Symbol name", { exact: true })).toBeFocused();
		await page.getByLabel("Symbol name", { exact: true }).fill("New chip");
		await page.getByRole("button", { name: "Create symbol", exact: true }).click();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · New chip");
		await expect(page.locator("html")).toHaveAttribute("data-worksheet", "none");
	};
	await create();
	expect((await documentState(page)).editorShapes).toEqual([]);
	expect((await documentState(page)).symbols[0]).toMatchObject({ name: "New chip", id: "new-chip", shapes: [] });
	await projectsPage(page);
	await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(page.getByRole("button", { name: "Insert New chip", exact: true })).toBeDisabled();
	await page.keyboard.press("Escape");
	await projectsPage(page);
	await page.getByRole("link", { name: "Open new-chip.ecadsym", exact: true }).click();
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).symbols[0].shapes.length).toBe(1);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await documentState(page)).symbols[0].shapes.length).toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await documentState(page)).symbols[0].shapes.length).toBe(1);
	await page.reload();
	await page.getByRole("link", { name: "Open new-chip.ecadsym", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(1);
	expect((await documentState(page)).shapes).toEqual([]);
	await projectsPage(page);
	await create();
	expect((await documentState(page)).symbols.map((symbol: { id: string }) => symbol.id)).toEqual(["new-chip", "new-chip-2"]);
	expect((await documentState(page)).editorShapes).toEqual([]);
	await projectsPage(page);
	await expect(page.getByRole("link", { name: "Open new-chip.ecadsym", exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "Open new-chip-2.ecadsym", exact: true })).toBeVisible();
});

test("new symbol creation keeps the dialog open on save failure and allows retry", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "New symbol retry");
	await page.evaluate(() => {
		const original = FileSystemFileHandle.prototype.createWritable;
		FileSystemFileHandle.prototype.createWritable = function(...args) {
			if (this.name === ".ecadprj") throw new DOMException("Quota exceeded", "QuotaExceededError");
			return original.apply(this, args);
		};
		window.addEventListener("restore-writes", () => { FileSystemFileHandle.prototype.createWritable = original; }, { once: true });
	});
	await page.getByRole("button", { name: "New symbol", exact: true }).click();
	await page.getByLabel("Symbol name", { exact: true }).fill("Retry part");
	await page.getByRole("button", { name: "Create symbol", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(page.getByRole("alert")).toContainText("Quota exceeded");
	expect((await documentState(page)).symbols).toEqual([]);
	await page.evaluate(() => window.dispatchEvent(new Event("restore-writes")));
	await page.getByRole("button", { name: "Create symbol", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Retry part");
	expect((await documentState(page)).symbols).toHaveLength(1);
	expect((await documentState(page)).symbols[0].id).toBe("retry-part");
	await page.reload();
	await expect(page.getByRole("link", { name: "Open retry-part.ecadsym", exact: true })).toBeVisible();
});
