import type { Page } from "@playwright/test";
import { required } from "../helpers/required.ts";
import {
	openPrimaryDrawing,
	openProjectActions,
	openProjectFiles,
	projectRail,
} from "./project-files";
import { expect, test } from "./seeded-project";
import { toolbarButton } from "./toolbar";

const documentState = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent()) ?? "{}");
async function drawRectangle(page: Page) {
	await (await toolbarButton(page, "Rectangle")).click();
	// Span several 50 mil grid cells even when a tiny symbol fits the view.
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(1000, 500);
	await page.mouse.up();
}

test("new circuit schematics keep separate edits and undo histories, survive reloads and use distinct names", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await openPrimaryDrawing(page);
	await drawRectangle(page);
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(1);
	const primary = (await documentState(page)).shapes;
	const createDrawing = async () => {
		await projectRail(page)
			.getByRole("button", { name: "Add file", exact: true })
			.click();
		await page
			.getByRole("menuitem", { name: "New circuit", exact: true })
			.click();
		await expect(
			page.getByLabel("Circuit name", { exact: true }),
		).toBeFocused();
		await page.getByLabel("Circuit name", { exact: true }).fill("Power stage");
		await page
			.getByRole("button", { name: "Create circuit", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Switch to schematic view", exact: true })
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
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	// Leave the sidebar overlay so it no longer covers the toolbar.
	await page.mouse.move(900, 450);
	await (await toolbarButton(page, "Undo")).click();
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(0);
	await (await toolbarButton(page, "Redo")).click();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Power stage.ecaddraw", exact: true })
		.click();
	// Leave the sidebar overlay so it no longer covers the toolbar.
	await page.mouse.move(900, 450);
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
	await expect(
		(await openProjectFiles(page)).getByRole("link", {
			name: "Open Power stage 2.ecaddraw",
			exact: true,
		}),
	).toBeVisible();
	expect((await documentState(page)).drawings).toHaveLength(2);
	expect((await documentState(page)).editorShapes).toEqual([]);
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Power stage.ecaddraw", exact: true })
		.click();
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBe(1);
	expect((await documentState(page)).shapes).toEqual(primary);
	await projectRail(page)
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
});

test("the sidebar Open project button lists saved web projects and switches to one", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect
		.poll(async () => (await documentState(page)).name)
		.toBe("Untitled");
	const openMenu = async () => {
		await projectRail(page)
			.getByRole("button", { name: "Open project", exact: true })
			.click();
		const menu = page.getByRole("menu", { name: "Open project", exact: true });
		await expect(menu.getByRole("menuitem").first()).toBeVisible();
		return menu;
	};
	// The web app cannot quit, so its sidebar has no Exit button.
	await expect(
		(await openProjectFiles(page)).getByRole("button", {
			name: "Exit",
			exact: true,
		}),
	).toHaveCount(0);
	let menu = await openMenu();
	await expect(menu.getByRole("menuitem")).toHaveCount(1);
	const first = await menu
		.locator('[role="menuitem"][aria-current="true"]')
		.textContent();
	await page.keyboard.press("Escape");

	await openProjectActions(page);
	await page
		.getByRole("menuitem", { name: "New untitled project", exact: true })
		.click();
	menu = await openMenu();
	await expect(menu.getByRole("menuitem")).toHaveCount(2);
	const current = menu.locator('[role="menuitem"][aria-current="true"]');
	await expect(current).toHaveCount(1);
	await expect(current).not.toHaveText(required(first));

	await menu
		.getByRole("menuitem", { name: required(first), exact: true })
		.click();
	menu = await openMenu();
	await expect(
		menu.locator('[role="menuitem"][aria-current="true"]'),
	).toHaveText(required(first));
});
