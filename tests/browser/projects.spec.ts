import { openProjectFiles, closeProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";
import { expect, test, type Page } from "@playwright/test";

const documentState = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent()) ?? "{}");
async function projectsPage(page: Page) {
	await (await openProjectFiles(page)).getByRole("link", { name: "Workspace home", exact: true }).click();
	await expect(page.locator("main")).toBeVisible();
	await closeProjectFiles(page);
}
async function createProject(page: Page, _name: string) {
	await projectsPage(page);
	await expect.poll(async () => (await documentState(page)).name).toBe("Untitled");
	await openProjectFiles(page);
}
async function drawRectangle(page: Page) {
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400);
	await page.mouse.up();
}

test("the global project preserves drawings and undo history across page navigation", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "History");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	await drawRectangle(page);
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(1);
	const original = (await documentState(page)).shapes;
	await projectsPage(page);
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	await expect
		.poll(async () => (await documentState(page)).shapes)
		.toEqual(original);
	await (await toolbarButton(page, "Undo")).click();
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await expect
		.poll(async () => (await documentState(page)).shapes)
		.toEqual(original);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	await page.reload();
	await expect
		.poll(async () => (await documentState(page)).shapes)
		.toEqual(original);
});

test("failed symbol saves keep edits available for retry and leave the schematic untouched", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Symbol save retry");
	await expect(
		(await openProjectFiles(page)).getByLabel("Add symbol files"),
	).toBeEnabled();
	await (await openProjectFiles(page))
		.getByLabel("Add symbol files")
		.setInputFiles({
			name: "retry.ecadsym",
			mimeType: "application/json",
			buffer: Buffer.from(
				JSON.stringify({
					format: "ecad-symbol",
					version: 1,
					units: "mm",
					id: "retry-symbol",
					name: "Retry symbol",
					description: "",
					prefix: "TP",
					value: "",
					shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }],
				}),
			),
		});
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open retry-symbol.ecadsym", exact: true })
		.click();
	await expect(page.locator("html")).toHaveAttribute("data-worksheet", "none");
	await page.evaluate(() => {
		const original = FileSystemFileHandle.prototype.createWritable;
		FileSystemFileHandle.prototype.createWritable = function (...args) {
			if (this.name === ".ecadprj")
				throw new DOMException("Quota exceeded", "QuotaExceededError");
			return original.apply(this, args);
		};
		window.addEventListener(
			"restore-writes",
			() => {
				FileSystemFileHandle.prototype.createWritable = original;
			},
			{ once: true },
		);
	});
	await drawRectangle(page);
	await expect(page.getByRole("alert")).toContainText("Quota exceeded");
	expect((await documentState(page)).editorShapes).toHaveLength(2);
	expect((await documentState(page)).symbols[0].shapes).toHaveLength(1);
	expect((await documentState(page)).shapes).toEqual([]);
	expect((await documentState(page)).dirty).toBe(true);
	await page.evaluate(() => window.dispatchEvent(new Event("restore-writes")));
	await projectsPage(page);
	await page.getByRole("button", { name: "Project actions", exact: true }).click();
	await page.getByRole("menuitem", { name: "Save project", exact: true }).click();
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	expect((await documentState(page)).symbols[0].shapes).toHaveLength(2);
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open retry-symbol.ecadsym", exact: true })
		.click();
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBe(2);
	expect((await documentState(page)).shapes).toEqual([]);
});

test("new drawings keep separate edits and undo histories, survive reloads and use distinct names", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await createProject(page, "Multiple drawings");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	await drawRectangle(page);
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(1);
	const primary = (await documentState(page)).shapes;
	const createDrawing = async () => {
		await (await openProjectFiles(page))
			.getByRole("button", { name: "Add file", exact: true })
			.click();
		await page
			.getByRole("menuitem", { name: "New drawing", exact: true })
			.click();
		await expect(
			page.getByLabel("Drawing name", { exact: true }),
		).toBeFocused();
		await page.getByLabel("Drawing name", { exact: true }).fill("Power stage");
		await page
			.getByRole("button", { name: "Create drawing", exact: true })
			.click();
		await expect(page.getByRole("heading", { level: 1 })).toContainText(
			"Schematic editor · Power stage",
		);
		await expect(
			page.getByRole("button", { name: "Select", exact: true }),
		).toBeEnabled();
	};
	await createDrawing();
	expect((await documentState(page)).editorShapes).toEqual([]);
	expect((await documentState(page)).shapes).toEqual(primary);
	await drawRectangle(page);
	await expect
		.poll(async () => (await documentState(page)).drawings[0].shapes.length)
		.toBe(1);
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Drawing", exact: true })
		.click();
	await (await toolbarButton(page, "Undo")).click();
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open power-stage.ecaddraw", exact: true })
		.click();
	await (await toolbarButton(page, "Undo")).click();
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBe(0);
	expect((await documentState(page)).shapes).toEqual(primary);
	await (await toolbarButton(page, "Redo")).click();
	await expect
		.poll(async () => (await documentState(page)).drawings[0].shapes.length)
		.toBe(1);
	await createDrawing();
	expect(
		(await documentState(page)).drawings.map((file: { id: string }) => file.id),
	).toEqual(["power-stage", "power-stage-2"]);
	expect((await documentState(page)).editorShapes).toEqual([]);
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open power-stage.ecaddraw", exact: true })
		.click();
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBe(1);
	expect((await documentState(page)).shapes).toEqual(primary);
	await (await openProjectFiles(page))
		.getByRole("button", { name: "Add file", exact: true })
		.click();
	await page.getByRole("menuitem", { name: "New symbol", exact: true }).click();
	await page
		.getByLabel("Symbol name", { exact: true })
		.fill("Drawing companion");
	await page
		.getByRole("button", { name: "Create symbol", exact: true })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Symbol editor · Drawing companion",
	);
	expect((await documentState(page)).editorShapes).toEqual([]);
	expect((await documentState(page)).drawings[0].shapes).toHaveLength(1);
	await createProject(page, "Copied drawings");
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open power-stage.ecaddraw", exact: true })
		.click();
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBe(1);
});

test("new symbols start empty, persist edits, and use distinct files for repeated names", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect(
		(await openProjectFiles(page)).getByRole("button", {
			name: "Add file",
			exact: true,
		}),
	).toBeEnabled();
	await createProject(page, "New symbols");
	await (await openProjectFiles(page))
		.getByRole("button", { name: "Add file", exact: true })
		.click();
	await page.getByRole("menuitem", { name: "New symbol", exact: true }).click();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	expect((await documentState(page)).symbols).toEqual([]);
	const create = async () => {
		await (await openProjectFiles(page))
			.getByRole("button", { name: "Add file", exact: true })
			.click();
		await page
			.getByRole("menuitem", { name: "New symbol", exact: true })
			.click();
		await expect(page.getByLabel("Symbol name", { exact: true })).toBeFocused();
		await page.getByLabel("Symbol name", { exact: true }).fill("New chip");
		await page
			.getByRole("button", { name: "Create symbol", exact: true })
			.click();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Symbol editor · New chip",
		);
		await expect(page.locator("html")).toHaveAttribute(
			"data-worksheet",
			"none",
		);
	};
	await create();
	expect((await documentState(page)).editorShapes).toEqual([]);
	expect((await documentState(page)).symbols[0]).toMatchObject({
		name: "New chip",
		id: "new-chip",
		shapes: [],
	});
	await projectsPage(page);
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Insert New chip", exact: true }),
	).toBeDisabled();
	await page.keyboard.press("Escape");
	await projectsPage(page);
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open new-chip.ecadsym", exact: true })
		.click();
	await drawRectangle(page);
	await expect
		.poll(async () => (await documentState(page)).symbols[0].shapes.length)
		.toBe(1);
	await (await toolbarButton(page, "Undo")).click();
	await expect
		.poll(async () => (await documentState(page)).symbols[0].shapes.length)
		.toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await expect
		.poll(async () => (await documentState(page)).symbols[0].shapes.length)
		.toBe(1);
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open new-chip.ecadsym", exact: true })
		.click();
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBe(1);
	expect((await documentState(page)).shapes).toEqual([]);
	await projectsPage(page);
	await create();
	expect(
		(await documentState(page)).symbols.map(
			(symbol: { id: string }) => symbol.id,
		),
	).toEqual(["new-chip", "new-chip-2"]);
	expect((await documentState(page)).editorShapes).toEqual([]);
	await projectsPage(page);
	await expect(
		(await openProjectFiles(page)).getByRole("link", {
			name: "Open new-chip.ecadsym",
			exact: true,
		}),
	).toBeVisible();
	await expect(
		(await openProjectFiles(page)).getByRole("link", {
			name: "Open new-chip-2.ecadsym",
			exact: true,
		}),
	).toBeVisible();
});
