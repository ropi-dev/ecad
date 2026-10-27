import { openProjectFiles, closeProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const documentState = async (page: Page) => JSON.parse(await page.locator("#project-document").textContent() ?? "{}");
async function projectsPage(page: Page) {
	await expect(page.locator("#project-document")).toBeAttached();
	if (!(await page.getByRole("heading", { name: "Projects", exact: true }).isVisible())) {
		await (await openProjectFiles(page)).getByRole("link", { name: "Projects", exact: true }).click();
	}
	await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
	await closeProjectFiles(page);
}
async function createProject(page: Page, name: string) {
	await projectsPage(page);
	await page.getByLabel("Project name", { exact: true }).fill(name);
	await page.getByRole("button", { name: "Create project", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).name).toBe(name);
	await expect(page.getByLabel("Project save status")).toHaveText("Saved");
	await openProjectFiles(page);
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
	await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(1);
	const original = (await documentState(page)).shapes;
	await projectsPage(page);
	await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).shapes).toEqual(original);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await documentState(page)).shapes).toEqual(original);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	await page.reload();
	await expect.poll(async () => (await documentState(page)).shapes).toEqual(original);
});

test("pin names and numbers autosave and reload with the project", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Pin labels");
	await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
	await (await toolbarButton(page, "Pin")).click();
	await page.locator("canvas").click({ position: { x: 500, y: 350 } });
	for (const [label, value] of [["Name", "VCC"], ["Number", "01"]]) {
		await page.getByRole("textbox", { name: label, exact: true }).fill(value);
		await page.getByRole("textbox", { name: label, exact: true }).press("Enter");
	}
	await expect.poll(async () => (await documentState(page)).shapes[0]).toMatchObject({ name: "VCC", number: "01" });
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	const saved = (await documentState(page)).shapes;
	await page.reload();
	await expect.poll(async () => (await documentState(page)).shapes).toEqual(saved);
});

test("projects manage symbols on a separate page and isolate switched projects", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "First");
	await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(1);
	const original = (await documentState(page)).shapes;
	await projectsPage(page);
	await (await openProjectFiles(page)).getByLabel("Add symbol files").setInputFiles({ name: "sample.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "ecad-symbol", version: 1, units: "mm", id: "project-symbol", name: "Project symbol", description: "", prefix: "TP", value: "", shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }] })) });
	await expect(page.getByText("project-symbol.ecadsym", { exact: true })).toBeVisible();
	await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(page.getByRole("button", { name: "Insert Project symbol", exact: true })).toBeVisible();
	await expect(page.getByLabel("Upload symbol files")).toHaveCount(0);
	await expect(page.getByText("project-symbol.ecadsym", { exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.reload();
	await expect.poll(async () => (await documentState(page)).shapes).toEqual(original);
	await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(page.getByRole("button", { name: "Insert Project symbol", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await createProject(page, "Second");
	await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await page.mouse.click(650, 350);
	await page.keyboard.press("Delete");
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(0);
	await projectsPage(page);
	await page.getByRole("button", { name: "First", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).name).toBe("First");
	await expect.poll(async () => (await documentState(page)).shapes).toEqual(original);
});

test("project Gerber files remain listed across workspaces", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Board");
	const gerber = "%FSLAX24Y24*%\n%MOMM*%\n%ADD10C,1*%\nD10*\nX000000Y000000D03*\nM02*";
	await (await openProjectFiles(page)).getByLabel("Add Gerber files").setInputFiles({ name: "board.gbr", mimeType: "text/plain", buffer: Buffer.from(gerber) });
	await expect.poll(async () => (await documentState(page)).assets?.length).toBe(1);
	await expect(page.getByText("board.gbr", { exact: true })).toBeVisible();
	await (await openProjectFiles(page)).getByRole("link", { name: "Open board.gbr", exact: true }).click();
	await expect(page.locator("canvas")).toBeVisible();
	await expect(page.getByLabel("Open Gerber file")).toHaveCount(0);
	await expect(page.getByText("board.gbr", { exact: true })).toBeVisible();
	await projectsPage(page);
	await page.reload();
	await expect.poll(async () => (await documentState(page)).name).toBe("Board");
	await openProjectFiles(page);
	await expect(page.getByText("board.gbr", { exact: true })).toBeVisible();
	await expect.poll(async () => (await documentState(page)).assets?.length).toBe(1);
});

test("project STEP files open from the sidebar and copy with new projects", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Model");
	await (await openProjectFiles(page)).getByLabel("Add STEP files").setInputFiles(resolve("node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp"));
	await expect.poll(async () => (await documentState(page)).assets?.length).toBe(1);
	await (await openProjectFiles(page)).getByRole("link", { name: "Open cube.stp", exact: true }).click();
	await expect(page.getByRole("button", { name: "Fit model", exact: true })).toBeEnabled({ timeout: 30000 });
	await expect(page.getByLabel("Open STEP file")).toHaveCount(0);
	await expect(page.getByText("cube.stp", { exact: true })).toBeVisible();
	await createProject(page, "Model copy");
	await expect.poll(async () => (await documentState(page)).assets?.length).toBe(1);
	await page.reload();
	await expect.poll(async () => (await documentState(page)).name).toBe("Model copy");
	await (await openProjectFiles(page)).getByRole("link", { name: "Open cube.stp", exact: true }).click();
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
 await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
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
 await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(page.getByRole("button", { name: "Insert Project point", exact: true })).toBeVisible();
 await expect(page.getByRole("button", { name: "Insert User point", exact: true })).toHaveCount(0);
 await page.keyboard.press("Escape");
 await projectsPage(page);
 await page.getByText("Symbol libraries", { exact: true }).click();
 const projectLibraries = page.getByRole("group", { name: "Project libraries", exact: true });
 await projectLibraries.getByRole("checkbox", { name: "Project parts", exact: true }).uncheck();
 await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(page.getByRole("button", { name: "Insert User point", exact: true })).toBeVisible();
 await page.keyboard.press("Escape");
 await createProject(page, "Libraries second");
 await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(page.getByRole("button", { name: "Insert User point", exact: true })).toBeVisible();
 expect(await page.evaluate(() => localStorage.getItem("ecad.user-config.v1"))).toBe(savedUser);
});

test("failed project library configuration saves restore the checkbox and saved definitions", async ({ page }) => {
 await page.goto("/tests/browser/projects.html");
 await createProject(page, "Library rollback");
 await (await openProjectFiles(page)).getByLabel("Add symbol files").setInputFiles({ name: "point.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "ecad-symbol", version: 1, units: "mm", id: "rollback-point", name: "Rollback point", description: "", prefix: "TP", value: "", shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }] })) });
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
 await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await expect(page.getByRole("button", { name: "Insert Rollback point", exact: true })).toBeVisible();
});

test("opening a symbol file removes the worksheet and edits only that symbol", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "File editing");
	await (await openProjectFiles(page)).getByRole("link", { name: "Open Drawing", exact: true }).click();
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(1);
	const schematic = (await documentState(page)).shapes;
	await projectsPage(page);
	const symbol = { format: "ecad-symbol", version: 1, units: "mm", id: "editable-symbol", name: "Editable symbol", description: "Keep this metadata", prefix: "TP", value: "Signal", shapes: [{ kind: "rectangle", x: 3, y: -2, width: 10, height: 6 }, { kind: "pin", name: "Signal", x: -4, y: 0 }] };
	await (await openProjectFiles(page)).getByLabel("Add symbol files").setInputFiles({ name: "editable-symbol.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(symbol)) });
	await (await openProjectFiles(page)).getByRole("link", { name: "Open editable-symbol.ecadsym", exact: true }).click();
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
	await (await openProjectFiles(page)).getByRole("link", { name: "Open Drawing", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Schematic editor · A3");
	await expect(page.locator("html")).toHaveAttribute("data-worksheet", "A3, 420 × 297 mm");
	await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(1);
	await page.screenshot({ path: test.info().outputPath("schematic-file.png") });
	expect((await documentState(page)).shapes).toEqual(schematic);
	await projectsPage(page);
	await (await openProjectFiles(page)).getByRole("link", { name: "Open editable-symbol.ecadsym", exact: true }).click();
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(2);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(3);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link", { name: "Open editable-symbol.ecadsym", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-worksheet", "none");
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(3);
	expect((await documentState(page)).shapes).toEqual(schematic);
});

test("failed symbol saves keep edits available for retry and leave the schematic untouched", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Symbol save retry");
	await expect((await openProjectFiles(page)).getByLabel("Add symbol files")).toBeEnabled();
	await (await openProjectFiles(page)).getByLabel("Add symbol files").setInputFiles({ name: "retry.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "ecad-symbol", version: 1, units: "mm", id: "retry-symbol", name: "Retry symbol", description: "", prefix: "TP", value: "", shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }] })) });
	await (await openProjectFiles(page)).getByRole("link", { name: "Open retry-symbol.ecadsym", exact: true }).click();
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
	await (await openProjectFiles(page)).getByRole("link", { name: "Open retry-symbol.ecadsym", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(2);
	expect((await documentState(page)).shapes).toEqual([]);
});

test("new drawings keep separate edits and undo histories, survive reloads and use distinct names", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Multiple drawings");
	await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(1);
	const primary = (await documentState(page)).shapes;
	const createDrawing = async () => {
		await (await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true }).click();
		await page.getByRole("menuitem", { name: "New drawing", exact: true }).click();
		await expect(page.getByLabel("Drawing name", { exact: true })).toBeFocused();
		await page.getByLabel("Drawing name", { exact: true }).fill("Power stage");
		await page.getByRole("button", { name: "Create drawing", exact: true }).click();
		await expect(page.getByRole("heading", { level: 1 })).toContainText("Schematic editor · Power stage");
		await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
	};
	await createDrawing();
	expect((await documentState(page)).editorShapes).toEqual([]);
	expect((await documentState(page)).shapes).toEqual(primary);
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).drawings[0].shapes.length).toBe(1);
	await (await openProjectFiles(page)).getByRole("link", { name: "Open Drawing", exact: true }).click();
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await (await openProjectFiles(page)).getByRole("link", { name: "Open power-stage.ecaddraw", exact: true }).click();
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(0);
	expect((await documentState(page)).shapes).toEqual(primary);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await documentState(page)).drawings[0].shapes.length).toBe(1);
	await createDrawing();
	expect((await documentState(page)).drawings.map((file: { id: string }) => file.id)).toEqual(["power-stage", "power-stage-2"]);
	expect((await documentState(page)).editorShapes).toEqual([]);
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link", { name: "Open power-stage.ecaddraw", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(1);
	expect((await documentState(page)).shapes).toEqual(primary);
	await (await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true }).click();
	await page.getByRole("menuitem", { name: "New symbol", exact: true }).click();
	await page.getByLabel("Symbol name", { exact: true }).fill("Drawing companion");
	await page.getByRole("button", { name: "Create symbol", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Drawing companion");
	expect((await documentState(page)).editorShapes).toEqual([]);
	expect((await documentState(page)).drawings[0].shapes).toHaveLength(1);
	await createProject(page, "Copied drawings");
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link", { name: "Open power-stage.ecaddraw", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(1);
});

test("drawing creation validates names, cancels cleanly and allows retry after a save failure", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Drawing retry");
	const openDialog = async () => {
		await (await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true }).click();
		await page.getByRole("menuitem", { name: "New drawing", exact: true }).click();
	};
	await openDialog();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	expect((await documentState(page)).drawings).toBeUndefined();
	await openDialog();
	await page.getByLabel("Drawing name", { exact: true }).fill("invalid/name");
	await page.getByRole("button", { name: "Create drawing", exact: true }).click();
	await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
	await page.evaluate(() => {
		const original = FileSystemFileHandle.prototype.createWritable;
		FileSystemFileHandle.prototype.createWritable = function(...args) {
			if (this.name === ".ecadprj") throw new DOMException("Quota exceeded", "QuotaExceededError");
			return original.apply(this, args);
		};
		window.addEventListener("restore-writes", () => { FileSystemFileHandle.prototype.createWritable = original; }, { once: true });
	});
	await page.getByLabel("Drawing name", { exact: true }).fill("Retry drawing");
	await page.getByRole("button", { name: "Create drawing", exact: true }).click();
	await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Quota exceeded");
	expect((await documentState(page)).drawings).toBeUndefined();
	await page.evaluate(() => window.dispatchEvent(new Event("restore-writes")));
	await page.getByRole("button", { name: "Create drawing", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Schematic editor · Retry drawing");
	expect((await documentState(page)).drawings).toHaveLength(1);
});

test("new symbols start empty, persist edits, and use distinct files for repeated names", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await expect((await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true })).toHaveCount(0);
	await createProject(page, "New symbols");
	await (await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true }).click();
	await page.getByRole("menuitem", { name: "New symbol", exact: true }).click();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	expect((await documentState(page)).symbols).toEqual([]);
	const create = async () => {
		await (await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true }).click();
		await page.getByRole("menuitem", { name: "New symbol", exact: true }).click();
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
	await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(page.getByRole("button", { name: "Insert New chip", exact: true })).toBeDisabled();
	await page.keyboard.press("Escape");
	await projectsPage(page);
	await (await openProjectFiles(page)).getByRole("link", { name: "Open new-chip.ecadsym", exact: true }).click();
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).symbols[0].shapes.length).toBe(1);
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await documentState(page)).symbols[0].shapes.length).toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await expect.poll(async () => (await documentState(page)).symbols[0].shapes.length).toBe(1);
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link", { name: "Open new-chip.ecadsym", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).editorShapes.length).toBe(1);
	expect((await documentState(page)).shapes).toEqual([]);
	await projectsPage(page);
	await create();
	expect((await documentState(page)).symbols.map((symbol: { id: string }) => symbol.id)).toEqual(["new-chip", "new-chip-2"]);
	expect((await documentState(page)).editorShapes).toEqual([]);
	await projectsPage(page);
	await expect((await openProjectFiles(page)).getByRole("link", { name: "Open new-chip.ecadsym", exact: true })).toBeVisible();
	await expect((await openProjectFiles(page)).getByRole("link", { name: "Open new-chip-2.ecadsym", exact: true })).toBeVisible();
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
	await (await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true }).click();
	await page.getByRole("menuitem", { name: "New symbol", exact: true }).click();
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
	await expect((await openProjectFiles(page)).getByRole("link", { name: "Open retry-part.ecadsym", exact: true })).toBeVisible();
});


test("the file sidebar reports failed symbol imports while the editor is open", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Sidebar import errors");
	await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
	const sidebar = await openProjectFiles(page);
	await sidebar.getByLabel("Add symbol files").setInputFiles({ name: "broken.ecadsym", mimeType: "application/json", buffer: Buffer.from("invalid symbol") });
	await expect(sidebar.getByRole("alert")).toBeVisible();
	await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
	await expect(page.getByRole("tree", { name: "Drawing items", exact: true })).toHaveCount(0);
});

test("the layout sidebar owns the workspace tiles and connects MCP to the active drawing", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Sidebar essentials");
	const sidebar = await openProjectFiles(page);
	await sidebar.getByRole("link", { name: "Schematic editor", exact: true }).click();
	const workspaces = sidebar.getByRole("navigation", { name: "Workspaces", exact: true });
	await expect(workspaces.getByRole("link")).toHaveCount(3);
	await expect(workspaces.getByRole("button", { name: "Enable MCP", exact: true })).toBeEnabled();
	await expect(page.locator("main").getByRole("link", { name: "Gerber viewer", exact: true })).toHaveCount(0);
	const panelBounds = (await sidebar.locator("..").boundingBox())!;
	const canvasBounds = (await page.locator("canvas").boundingBox())!;
	expect(canvasBounds.x).toBe(panelBounds.width);
	expect(panelBounds.x).toBe(0);
	expect(panelBounds.y).toBe(0);
	expect(panelBounds.height).toBe(page.viewportSize()!.height);
	await workspaces.getByRole("button", { name: "Enable MCP", exact: true }).click();
	await expect(page.getByText("Connected to this drawing", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Disable MCP", exact: true }).click();
	await workspaces.getByRole("link", { name: "STEP viewer", exact: true }).click();
	await expect(workspaces.getByRole("link", { name: "Schematic editor", exact: true })).toBeVisible();
	await expect(page.locator("main").getByRole("link", { name: "Projects", exact: true })).toHaveCount(0);
	await sidebar.getByRole("button", { name: "Hide project files", exact: true }).click();
	await page.setViewportSize({ width: 390, height: 844 });
	await workspaces.getByRole("link", { name: "Schematic editor", exact: true }).click();
	await workspaces.getByRole("button", { name: "Enable MCP", exact: true }).click();
	await expect(page.getByText("Connected to this drawing", { exact: true })).toBeVisible();
	const settingsPanel = page.getByRole("region", { name: "MCP connection", exact: true });
	await expect.poll(async () => {
		const bounds = (await settingsPanel.boundingBox())!;
		return bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844;
	}).toBe(true);
	const settings = (await settingsPanel.boundingBox())!;
	expect(settings.x).toBeGreaterThanOrEqual(0);
	expect(settings.x + settings.width).toBeLessThanOrEqual(390);
	expect(settings.y + settings.height).toBeLessThanOrEqual(844);
	await page.keyboard.press("Escape");
	await expect(sidebar).toHaveAttribute("data-open", "false");
	await expect(workspaces.getByRole("button", { name: "MCP connected", exact: true })).toBeFocused();
});
