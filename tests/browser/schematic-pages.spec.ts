import { expect, type Page, test } from "@playwright/test";

interface SceneState {
	shapes: { name: string }[];
}

const wireNames = async (page: Page) => {
	const scene: SceneState = JSON.parse(
		(await page.locator("#editor-scene").textContent()) || "{}",
	);
	return (scene.shapes ?? [])
		.map((shape) => shape.name)
		.filter((name) => name.startsWith("wire "))
		.sort();
};

const drawingPages = (page: Page) =>
	page.evaluate(async () => {
		const editorUrl = "/tests/browser/editor.tsx";
		const editor = (await import(editorUrl)) as typeof import("./editor.tsx");
		const { pages, shapes } = editor.drawingStore.getSnapshot();
		return {
			pages: pages ?? null,
			shapes: shapes.map((shape) => [shape.id, shape.page ?? null]),
		};
	});

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await page.evaluate(async () => {
		const editorUrl = "/tests/browser/editor.tsx";
		const editor = (await import(editorUrl)) as typeof import("./editor.tsx");
		const storeUrl = "/packages/drawing-core/src/commands/drawing-store.ts";
		const { createDrawingStore } = (await import(
			storeUrl
		)) as typeof import("@ecad/drawing-core/commands/drawing-store.ts");
		const wire = (id: number, y: number, page?: number) => ({
			id,
			kind: "wire" as const,
			x: 0,
			y,
			width: 20,
			height: 0.254,
			rotation: 0,
			lineWidth: 0.254,
			...(page === undefined ? {} : { page }),
		});
		editor.drawingStore.transact(() => [
			undefined,
			createDrawingStore(
				[wire(1, 0), wire(2, 10, 2), wire(3, 20, 2)],
				[
					{ id: 1, name: "Main" },
					{ id: 2, name: "Power" },
				],
			).getSnapshot(),
		]);
	});
});

test("page tabs show each page's shapes, and the page list edits pages with undo", async ({
	page,
}) => {
	const pages = page.getByRole("navigation", { name: "Schematic pages" });
	const main = pages.getByRole("button", { name: "Main", exact: true });
	const power = pages.getByRole("button", { name: "Power", exact: true });
	await expect(main).toHaveAttribute("aria-current", "page");
	await expect.poll(() => wireNames(page)).toEqual(["wire 1"]);

	await power.click();
	await expect(power).toHaveAttribute("aria-current", "page");
	await expect.poll(() => wireNames(page)).toEqual(["wire 2", "wire 3"]);
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"Power (page 2 of 2)",
	);

	await pages.getByRole("button", { name: "Add page", exact: true }).click();
	const added = pages.getByRole("button", { name: "Page 3", exact: true });
	await expect(added).toHaveAttribute("aria-current", "page");
	await expect.poll(() => wireNames(page)).toEqual([]);

	await pages.getByRole("button", { name: "Page list", exact: true }).click();
	const list = page.getByRole("region", { name: "Pages", exact: true });
	await list.getByRole("button", { name: "Rename Power", exact: true }).click();
	const name = list.getByRole("textbox", { name: "Name of Power" });
	await name.fill("Supply");
	await name.press("Enter");
	await expect(
		list.getByRole("button", { name: "Open Supply", exact: true }),
	).toBeVisible();
	await list
		.getByRole("button", { name: "Move Supply up", exact: true })
		.click();
	await list
		.getByRole("button", { name: "Delete Page 3", exact: true })
		.click();
	await expect
		.poll(() => drawingPages(page))
		.toEqual({
			pages: [
				{ id: 2, name: "Supply" },
				{ id: 1, name: "Main" },
			],
			// The first page's shapes omit `page`.
			shapes: [
				[1, 1],
				[2, null],
				[3, null],
			],
		});
	// Deleting the current page shows the page that took its place.
	await expect(
		pages.getByRole("button", { name: "Main", exact: true }),
	).toHaveAttribute("aria-current", "page");

	await page.keyboard.press("Escape");
	await page.locator("canvas").focus();
	await page.keyboard.press("ControlOrMeta+z");
	await page.keyboard.press("ControlOrMeta+z");
	await page.keyboard.press("ControlOrMeta+z");
	await expect
		.poll(() => drawingPages(page))
		.toMatchObject({
			pages: [
				{ id: 1, name: "Main" },
				{ id: 2, name: "Power" },
				{ id: 3, name: "Page 3" },
			],
		});
});

test("double-clicking a tab renames the page", async ({ page }) => {
	const pages = page.getByRole("navigation", { name: "Schematic pages" });
	await pages.getByRole("button", { name: "Main", exact: true }).dblclick();
	const name = pages.getByRole("textbox", { name: "Page name" });
	await name.fill("Inputs");
	await name.press("Enter");
	await expect(
		pages.getByRole("button", { name: "Inputs", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await pages.getByRole("button", { name: "Inputs", exact: true }).dblclick();
	await pages.getByRole("textbox", { name: "Page name" }).fill("Ignored");
	await pages.getByRole("textbox", { name: "Page name" }).press("Escape");
	await expect(
		pages.getByRole("button", { name: "Inputs", exact: true }),
	).toBeVisible();
});

test("clicking outside the page list keeps a rename in progress", async ({
	page,
}) => {
	const pages = page.getByRole("navigation", { name: "Schematic pages" });
	await pages.getByRole("button", { name: "Page list", exact: true }).click();
	const list = page.getByRole("region", { name: "Pages", exact: true });
	await list.getByRole("button", { name: "Rename Power", exact: true }).click();
	await list.getByRole("textbox", { name: "Name of Power" }).fill("Supply");
	await page.locator("canvas").click({ position: { x: 300, y: 400 } });
	await expect(list).toHaveCount(0);
	await expect(
		pages.getByRole("button", { name: "Supply", exact: true }),
	).toBeVisible();
});
